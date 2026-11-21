"""小米账号扫码登录模块

基于 xiaomusic 项目的 qrcode_login.py (MiJiaAPI) 对齐实现。
通过米家 APP 扫描二维码完成小米账号认证，获取 token 供 miservice 使用。

关键差异（相对本项目旧版）:
- User-Agent 改为随机生成并缓存到 auth.json，避免硬编码 UA 被风控
- pass_o 16 位 hex 懒加载并缓存
- locale 跟随系统（macOS 上是 zh_CN）
- callback 拿 serviceToken 用 session 直接取 cookies
"""

from __future__ import annotations

import base64
import hashlib
import json
import locale
import logging
import os
import random
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib import parse

import requests

from src import db as _db

logger = logging.getLogger(__name__)

# 小米扫码登录相关 URL（与 xiaomusic 上游一致）
LOGIN_URL = "https://account.xiaomi.com/longPolling/loginUrl"


def _generate_random(length: int, charset: str) -> str:
    return "".join(random.choices(charset, k=length))


def _get_locale() -> str:
    """获取系统 locale，默认 zh_CN"""
    try:
        loc = locale.getlocale()[0]
    except Exception:
        loc = None
    if not loc or "_" not in (loc or ""):
        return "zh_CN"
    return loc


class MiQRAuth:
    """小米账号二维码登录（对齐 xiaomusic MiJiaAPI）

    认证数据持久化以 SQLite（kv_store，data/xiaoai.db）为主：
    docker 重新部署后无需重新扫码。auth.json 仅作兼容备份与旧版迁移来源。
    """

    # kv_store 中认证数据的 key
    _DB_KEY = "mi_auth_data"

    def __init__(self, auth_dir: str | None = None):
        if auth_dir is None:
            auth_dir = os.path.join(os.path.dirname(__file__), "..")
        self.auth_dir = os.path.abspath(auth_dir)
        self.auth_path = os.path.join(self.auth_dir, "auth.json")
        self.auth_data: dict = {}

        self._locale = _get_locale()
        self.service_login_url = (
            f"https://account.xiaomi.com/pass/serviceLogin"
            f"?_json=true&sid=mijia&_locale={self._locale}"
        )

        self.auth_data = self._load_auth_data()

    def _load_auth_data(self) -> dict:
        """加载认证数据：数据库优先，auth.json 兜底并迁移入库"""
        # 1) 数据库优先
        try:
            raw = _db.get_kv(self._DB_KEY)
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict) and data:
                    logger.info("[MiQRAuth] 已从数据库加载认证数据")
                    return data
        except Exception as e:
            logger.warning(f"[MiQRAuth] 从数据库读取认证数据失败: {e}")

        # 2) auth.json 兜底（旧版数据迁移入库）
        if os.path.isfile(self.auth_path):
            try:
                with open(self.auth_path, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and data:
                    logger.info(f"[MiQRAuth] 从 auth.json 加载并迁移到数据库: {self.auth_path}")
                    self._save_to_db(data)
                    return data
            except Exception as e:
                logger.warning(f"[MiQRAuth] 加载 auth.json 失败: {e}")
        return {}

    # ------------------------------------------------------------------ #
    #  懒加载属性（与 xiaomusic 一致）
    # ------------------------------------------------------------------ #

    @property
    def device_id(self) -> str:
        if "deviceId" not in self.auth_data:
            self.auth_data["deviceId"] = _generate_random(
                16, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"
            )
        return self.auth_data["deviceId"]

    @property
    def pass_o(self) -> str:
        if "pass_o" not in self.auth_data:
            self.auth_data["pass_o"] = _generate_random(16, "0123456789abcdef")
        return self.auth_data["pass_o"]

    @property
    def user_agent(self) -> str:
        if "ua" in self.auth_data:
            return self.auth_data["ua"]
        ua_id1 = _generate_random(40, "0123456789ABCDEF")
        ua_id2 = _generate_random(32, "0123456789ABCDEF")
        ua_id3 = _generate_random(32, "0123456789ABCDEF")
        ua_id4 = _generate_random(40, "0123456789ABCDEF")
        country = self._locale.split("_")[1] if "_" in self._locale else "CN"
        self.auth_data["ua"] = (
            f"Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-"
            f"{ua_id1}-{country}-"
            f"{ua_id3}-{ua_id2}-SmartHome-MI_APP_STORE-{ua_id1}|{ua_id4}|{self.pass_o}-64"
        )
        return self.auth_data["ua"]

    # ------------------------------------------------------------------ #
    #  持久化
    # ------------------------------------------------------------------ #

    def _save_to_db(self, data: dict):
        """认证数据写入数据库（主存储）"""
        _db.set_kv(self._DB_KEY, json.dumps(data, ensure_ascii=False))
        logger.info("[MiQRAuth] 认证数据已保存到数据库")

    def _save_auth_data(self):
        self.auth_data["saveTime"] = int(time.time() * 1000)
        try:
            self._save_to_db(self.auth_data)
        except Exception as e:
            logger.error(f"[MiQRAuth] 认证数据写入数据库失败: {e}")
        # auth.json 仅作兼容备份，写失败（如 docker 挂载异常）不影响主流程
        try:
            os.makedirs(self.auth_dir, exist_ok=True)
            with open(self.auth_path, "w", encoding="utf-8") as f:
                json.dump(self.auth_data, f, indent=2, ensure_ascii=False)
            os.chmod(self.auth_path, 0o600)
            logger.info(f"[MiQRAuth] 认证数据已备份到: {self.auth_path}")
        except Exception as e:
            logger.warning(f"[MiQRAuth] auth.json 备份写入失败（不影响使用）: {e}")

    def update_from_miservice_token(self, token: dict):
        """miservice 刷新 token 后回写数据库

        miservice login('micoapi') 会刷新 micoapi（ssecurity/serviceToken），
        这里把最新值合并回 auth_data 并落库，保证下次启动直接用最新凭证。
        """
        if not token:
            return
        for key in ("userId", "passToken", "deviceId"):
            if token.get(key):
                self.auth_data[key] = token[key]
        micoapi = token.get("micoapi") or []
        if len(micoapi) >= 2 and micoapi[0]:
            self.auth_data["ssecurity"] = micoapi[0]
            self.auth_data["serviceToken"] = micoapi[1]
        self._save_auth_data()

    @staticmethod
    def _parse_service_ret(response: requests.Response) -> dict:
        text = response.text.replace("&&&START&&&", "")
        return json.loads(text)

    # ------------------------------------------------------------------ #
    #  serviceLogin → 拿登录链接 / 刷新 token
    # ------------------------------------------------------------------ #

    def _get_location(self) -> dict:
        """调用 serviceLogin 获取登录链接参数或刷新已有 token

        返回值约定：
          - {"code": 0, "message": "刷新Token成功"}  表示已有有效 token
          - {k: v0, ...}                            表示需要走二维码流程
        """
        headers = {
            "User-Agent": self.user_agent,
            "Connection": "keep-alive",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": (
                f"deviceId={self.device_id};"
                f"pass_o={self.pass_o};"
                f"passToken={self.auth_data.get('passToken', '')};"
                f"userId={self.auth_data.get('userId', '')};"
                f"cUserId={self.auth_data.get('cUserId', '')};"
                f"uLocale={self._locale};"
            ),
        }

        resp = requests.get(self.service_login_url, headers=headers, timeout=30)
        if resp.status_code != 200:
            raise ValueError(f"serviceLogin 请求失败: {resp.status_code}")
        data = self._parse_service_ret(resp)
        logger.debug(f"[MiQRAuth] serviceLogin 响应: {data}")

        location = data.get("location", "")
        if data.get("code") == 0 and location:
            session = requests.Session()
            ret = session.get(location, headers=headers, timeout=30)
            if ret.status_code == 200 and ret.text == "ok":
                cookies = session.cookies.get_dict()
                self.auth_data.update(cookies)
                self.auth_data["ssecurity"] = data.get("ssecurity", "")
                return {"code": 0, "message": "刷新Token成功"}

        location_data = parse.parse_qs(parse.urlparse(location).query)
        return {k: v[0] for k, v in location_data.items()}

    # ------------------------------------------------------------------ #
    #  公共 API
    # ------------------------------------------------------------------ #

    def get_qrcode(self) -> dict | bool:
        """获取二维码

        Returns:
            dict: 包含 qr / loginUrl / lp
            bool: False 表示已有有效 token，无需扫码
        """
        location_data = self._get_location()
        if (
            location_data.get("code", -1) == 0
            and location_data.get("message", "") == "刷新Token成功"
        ):
            self._save_auth_data()
            logger.info("[MiQRAuth] 刷新Token成功，无需扫码")
            return False

        params = {
            **location_data,
            "theme": "",
            "bizDeviceType": "",
            "_hasLogo": "false",
            "_qrsize": "240",
            "_dc": str(int(time.time() * 1000)),
        }
        url = LOGIN_URL + "?" + parse.urlencode(params)

        headers = {
            "User-Agent": self.user_agent,
            "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "Connection": "keep-alive",
        }

        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            raise ValueError(f"获取二维码失败: {resp.status_code}")
        data = self._parse_service_ret(resp)
        logger.debug(f"[MiQRAuth] 二维码响应: {data}")

        if data.get("code", 0) != 0:
            raise ValueError(f"获取二维码失败: {data.get('desc', '未知错误')}")

        return {
            "qr": data.get("qr", ""),
            "loginUrl": data.get("loginUrl", ""),
            "lp": data.get("lp", ""),
        }

    def wait_for_login(self, lp_url: str, timeout: int = 120) -> dict:
        """轮询等待扫码登录完成

        关键点（对齐 xiaomusic）：callback URL 直接 session.get 拿 cookies，
        serviceToken 就在 cookies 里。
        """
        session = requests.Session()
        headers = {
            "User-Agent": self.user_agent,
            "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "Connection": "keep-alive",
        }

        logger.info(f"[MiQRAuth] 开始轮询扫码状态，超时 {timeout}s...")
        try:
            resp = session.get(lp_url, headers=headers, timeout=timeout)
        except requests.exceptions.Timeout as e:
            raise ValueError("扫码超时，请重试") from e

        if resp.status_code != 200:
            raise ValueError(f"轮询扫码状态失败: {resp.status_code}")

        data = self._parse_service_ret(resp)
        logger.debug(f"[MiQRAuth] 扫码结果: {data}")

        if data.get("code", 0) != 0:
            raise ValueError(f"扫码登录失败: {data.get('desc', '未知错误')}")

        auth_keys = [
            "psecurity", "nonce", "ssecurity",
            "passToken", "userId", "cUserId",
        ]
        for key in auth_keys:
            if key in data:
                self.auth_data[key] = data[key]

        # callback 拿 serviceToken（与 xiaomusic 写法一致）
        callback_url = data.get("location", "")
        if callback_url:
            session.get(callback_url, headers=headers, timeout=30, allow_redirects=True)
            cookies = session.cookies.get_dict()
            self.auth_data.update(cookies)
            logger.info(f"[MiQRAuth] callback cookies: {list(cookies.keys())}")

        self.auth_data["expireTime"] = int(
            (datetime.now() + timedelta(days=30)).timestamp() * 1000
        )

        self._save_auth_data()
        logger.info("[MiQRAuth] 扫码登录成功！")
        return self.auth_data

    def get_miservice_token(self) -> dict | None:
        """获取 miservice 所需的 token 字典

        与 xiaomusic `account.token` 字段约定保持一致：
          {passToken, userId, deviceId, micoapi: [ssecurity, serviceToken]}
        """
        required = ["userId", "passToken", "ssecurity", "deviceId"]
        if not all(k in self.auth_data for k in required):
            return None

        return {
            "deviceId": self.device_id,
            "userId": self.auth_data["userId"],
            "passToken": self.auth_data["passToken"],
            "micoapi": [
                self.auth_data["ssecurity"],
                self.auth_data.get("serviceToken", ""),
            ],
        }

    def to_mi_token_file(self, token_path: str) -> bool:
        """将当前 auth 数据写入 miservice 的 .mi.token 文件"""
        token = self.get_miservice_token()
        if not token:
            logger.warning("[MiQRAuth] 没有有效的认证数据，无法写入 .mi.token")
            return False

        # 防御：docker 挂载源是目录而非文件时（如 .mi.token 路径被错误挂成目录），
        # 直接跳过写文件，避免把启动流程炸掉。
        if os.path.isdir(token_path):
            logger.warning(f"[MiQRAuth] token_path 是目录而非文件，跳过写入: {token_path}")
            return False

        try:
            os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)
            with open(token_path, "w", encoding="utf-8") as f:
                json.dump(token, f, indent=2, ensure_ascii=False)
            os.chmod(token_path, 0o600)
            logger.info(f"[MiQRAuth] 已写入 .mi.token: {token_path}")
            return True
        except Exception as e:
            logger.error(f"[MiQRAuth] 写入 .mi.token 失败: {e}")
            return False

    def is_logged_in(self) -> bool:
        return self.get_miservice_token() is not None

    def clear(self):
        self.auth_data = {}
        try:
            _db.delete_kv(self._DB_KEY)
            logger.info("[MiQRAuth] 已删除数据库中的认证数据")
        except Exception as e:
            logger.warning(f"[MiQRAuth] 删除数据库认证数据失败: {e}")
        if os.path.isfile(self.auth_path):
            try:
                os.remove(self.auth_path)
                logger.info(f"[MiQRAuth] 已删除: {self.auth_path}")
            except Exception as e:
                logger.warning(f"[MiQRAuth] 删除 {self.auth_path} 失败: {e}")
