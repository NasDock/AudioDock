from __future__ import annotations

import os
import logging
import asyncio
import urllib.parse
import socket
import json
import aiohttp
from miservice import MiAccount, MiNAService

from src.config import Config
from src.xiaomi_auth import MiQRAuth

logger = logging.getLogger(__name__)

# 需要使用 player_play_music API 的硬件型号列表
# 这些型号不支持 player_play_url，必须使用 player_play_music
_USE_PLAY_MUSIC_API = [
    "LX04", "LX05", "L05B", "L05C", "L06", "L06A", "LX06",
    "X08A", "X10A", "X08C", "X08E", "X8F", "X4B",
    "OH2", "OH2P", "X6A",
]


def _get_lan_ip() -> str:
    """获取本机局域网 IP（非 127.0.0.1）"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class SpeakerPlayer:
    """音箱播放控制：封装 miservice 实现设备发现、播放、停止、TTS 等功能

    新增播放列表支持：
    - _playlist: 当前播放列表（[{url, title, duration}]）
    - _playlist_index: 当前播放索引
    - _playlist_timer: 自动切歌定时器
    """

    def __init__(self):
        self.account: MiAccount | None = None
        self.service: MiNAService | None = None
        self.devices: list[dict] = []
        self._http_base: str = ""
        self._auto_next_timer: asyncio.TimerHandle | None = None
        self._current_device_id: str | None = None
        self._session: aiohttp.ClientSession | None = None
        self._login_ok: bool = False
        # 播放列表状态
        self._playlist: list[dict] = []
        self._playlist_index: int = 0
        self._playlist_device_id: str | None = None
        self._playlist_timer: asyncio.Task | None = None

    async def init(self) -> None:
        """初始化 miservice：尝试 token 登录 → 标记为未登录"""
        self._session = aiohttp.ClientSession()
        token_path = os.path.join(os.path.dirname(__file__), "..", ".mi.token")
        token_path = os.path.abspath(token_path)

        # 1. 优先尝试从 .mi.token / auth.json 加载已有 token
        if await self._try_token_login(token_path):
            logger.info("SpeakerPlayer init: 使用已有 token 登录成功")
            return

        # 2. 没有有效 token → 不再尝试密码登录（小米接口需要二次验证/扫码）
        #    用户必须通过 Web 控制台扫码登录
        logger.info("SpeakerPlayer init: 无有效 token，请访问 Web 控制台扫码登录")

        # 3. 都失败了，标记为未登录，但不抛异常（让服务继续运行，前端提示扫码）
        self._login_ok = False
        logger.warning(
            "SpeakerPlayer init: 未登录。请访问 Web 控制台进行扫码登录。"
        )

    async def _try_token_login(self, token_path: str) -> bool:
        """尝试从 .mi.token 或 auth.json 加载 token 登录

        对齐 xiaomusic auth.py login_miboy：
        1) 使用 MiTokenStore 包装 token 文件路径
        2) 创建 MiAccount 并显式调用 login('micoapi') 触发 serviceLogin + _securityTokenService
           → 这一步会刷新 micoapi 数组（ssecurity, serviceToken）
        3) 创建 MiNAService，调 device_list() 验证
        """
        from miservice import MiTokenStore

        token = None

        # 1) 先尝试 .mi.token（miservice 格式）
        if os.path.isfile(token_path):
            try:
                with open(token_path, encoding="utf-8") as f:
                    token = json.load(f)
                logger.info(f"加载 .mi.token: keys={list(token.keys()) if token else None}")
            except Exception as e:
                logger.warning(f"读取 .mi.token 失败: {e}")
                token = None

        # 2) 再尝试 auth.json（扫码登录保存的格式）作为兜底
        auth_path = os.path.join(os.path.dirname(__file__), "..", "auth.json")
        auth_path = os.path.abspath(auth_path)
        qr_auth = MiQRAuth()
        if (not token or "userId" not in token or "passToken" not in token) and qr_auth.is_logged_in():
            token = qr_auth.get_miservice_token()
            if token:
                qr_auth.to_mi_token_file(token_path)

        if not token or "userId" not in token or "passToken" not in token:
            return False

        # 3) 使用 MiTokenStore 创建 MiAccount，让 miservice 自动管理 token 持久化
        token_store = MiTokenStore(token_path)
        self.account = MiAccount(
            self._session,
            str(token.get("userId", "")),
            "",
            token_store,
        )

        # 4) 显式 login('micoapi') → 走 serviceLogin 拿 ssecurity → _securityTokenService 拿 serviceToken
        #    失败时不抛，miservice 内部已记录日志
        try:
            login_ok = await self.account.login("micoapi")
        except Exception as e:
            logger.warning(f"login(micoapi) 抛异常: {e}", exc_info=True)
            login_ok = False

        if not login_ok:
            # 区分 70016（需扫码）与临时网络失败
            error_str = str(self.account.token) if self.account else ""
            logger.warning(f"login(micoapi) 失败；token={list(self.account.token.keys()) if self.account and self.account.token else None}")
            self.account = None
            return False

        logger.info(f"MiAccount login(micoapi) 成功，token keys={list(self.account.token.keys())}")

        # miservice 刷新了 ssecurity/serviceToken，回写数据库（下次启动直接用最新凭证）
        try:
            qr_auth.update_from_miservice_token(self.account.token)
        except Exception as e:
            logger.warning(f"回写刷新后的 token 到数据库失败: {e}")

        # 5) 创建 MiNAService 并发现设备
        self.service = MiNAService(self.account)
        try:
            result = await self.service.device_list()
            self.devices = result or []
            self._login_ok = True
            await self._setup_http_base()
            logger.info(f"Token 登录成功，发现 {len(self.devices)} 个设备")
            return True
        except Exception as e:
            logger.warning(f"device_list 失败: {e}", exc_info=True)
            self.service = None
            self.account = None
            self._login_ok = False
            return False


    async def _setup_http_base(self) -> None:
        """构建 HTTP 文件服务基础 URL"""
        host = _get_lan_ip() if Config.HTTP_HOST == "0.0.0.0" else Config.HTTP_HOST
        self._http_base = f"http://{host}:{Config.HTTP_PORT}/music"
        logger.info(f"HTTP file base URL: {self._http_base}")

    async def _discover_devices(self) -> None:
        """发现绑定的小米音箱设备"""
        if not self.service:
            return
        try:
            result = await self.service.device_list()
            self.devices = result or []
            logger.info(f"Discovered {len(self.devices)} devices")
            for d in self.devices:
                logger.info(
                    f"  - {d.get('name', 'Unknown')} ({d.get('deviceID', 'N/A')})"
                )
        except Exception as e:
            logger.error(f"Device discovery failed: {e}", exc_info=True)
            self.devices = []

    def is_logged_in(self) -> bool:
        """是否已登录"""
        return self._login_ok

    async def reload_after_login(self) -> bool:
        """扫码登录成功后重新初始化"""
        if self._login_ok:
            return True
        # 关闭旧的 session，避免泄漏
        if self._session:
            try:
                await self._session.close()
            except Exception:
                pass
            self._session = None
        # 重置状态
        self.account = None
        self.service = None
        self.devices = []
        self._login_ok = False
        await self.init()
        return self._login_ok

    def file_to_url(self, filepath: str) -> str:
        """将本地文件路径转为音箱可访问的 HTTP URL

        路径策略：取所有扫描根中最长的公共前缀作为 base，使 URL 与
        `/music/{path:path}` 路由的实际挂载根一致。
        """
        filepath_abs = os.path.abspath(filepath)
        roots = [os.path.abspath(r) for r in Config.scan_roots()]

        rel_path = os.path.basename(filepath_abs)
        best_root: str | None = None
        for r in roots:
            try:
                candidate = os.path.relpath(filepath_abs, r)
            except ValueError:
                continue
            if candidate.startswith(".."):
                continue
            if best_root is None or len(r) > len(best_root):
                best_root = r
                rel_path = candidate

        if best_root is None:
            rel_path = os.path.basename(filepath_abs)

        encoded = "/".join(urllib.parse.quote(part) for part in rel_path.split(os.sep))
        return f"{self._http_base}/{encoded}"

    async def play_song(self, device_id: str, song: dict) -> bool:
        """播放指定歌曲（先 stop 再 play）"""
        if not self.service or not device_id:
            logger.warning("Service or device_id not available")
            return False

        try:
            await self.stop(device_id)
            await asyncio.sleep(0.3)

            url = self.file_to_url(song["path"])
            logger.info(f"Playing {song['name']} on {device_id} -> {url}")

            await self.play_by_url(device_id, url, song.get("name", ""))

            self._current_device_id = device_id

            duration = song.get("duration", 0)
            if duration > 0:
                self._schedule_auto_next(duration, device_id)

            return True
        except Exception as e:
            logger.error(f"Failed to play song: {e}", exc_info=True)
            return False

    async def play_by_url(self, device_id: str, url: str, title: str = "") -> bool:
        """通过 URL 直接推送到音箱播放（不依赖本地 MusicLibrary）

        适用于 desktop 等外部客户端把当前 track 的 stream URL 转发给小爱音箱。
        若 URL 不可被音箱直接访问（典型场景：URL 含 localhost / 内网 IP），
        会先用 mi 自己的 HTTP 服务代理为对音箱可达的地址再推送。

        根据硬件型号选择播放 API：
        - LX04, LX05, L05B, L05C, L06, L06A, X08A, X10A, X08C, X08E, X8F, X4B, OH2, OH2P, X6A
          等型号需要使用 player_play_music API
        - 其他型号使用 player_play_url
        """
        if not self.service or not device_id or not url:
            logger.warning("Service/device_id/url not available")
            return False

        try:
            await self.stop(device_id)
            await asyncio.sleep(0.3)

            proxied_url = await self._proxy_url_if_needed(url)
            logger.info(f"Play-by-url on {device_id}: {title or url} -> {proxied_url}")
            
            # 获取设备硬件型号
            hardware = self._get_device_hardware(device_id)
            
            # 根据硬件型号选择播放 API
            if hardware in _USE_PLAY_MUSIC_API:
                result = await self._play_by_music_url(device_id, proxied_url)
            else:
                result = await self.service.ubus_request(
                    device_id,
                    "player_play_url",
                    "mediaplayer",
                    {"url": proxied_url, "type": 1, "media": "app_ios"}
                )
            
            if not result:
                logger.warning(f"play failed for {device_id} (hardware={hardware})")
                return False
                
            self._current_device_id = device_id
            return True
        except Exception as e:
            logger.error(f"play_by_url failed: {e}", exc_info=True)
            return False

    def _get_device_hardware(self, device_id: str) -> str:
        """从设备列表中获取硬件型号"""
        for d in self.devices:
            if d.get("deviceID") == device_id:
                return d.get("hardware", "")
        return ""

    async def _play_by_music_url(self, device_id: str, url: str, audio_id: str = "1582971365183456177", title: str = "") -> bool:
        """使用 player_play_music API 播放（适配需要此 API 的硬件型号）
        
        支持单首播放和多首播放列表播放。
        """
        import json
        music = {
            "payload": {
                "audio_type": "MUSIC",
                "audio_items": [
                    {
                        "item_id": {
                            "audio_id": audio_id,
                            "cp": {
                                "album_id": "-1",
                                "episode_index": 0,
                                "id": "355454500",
                                "name": "xiaowei",
                            },
                        },
                        "stream": {"url": url},
                    }
                ],
                "list_params": {
                    "listId": "-1",
                    "loadmore_offset": 0,
                    "origin": "xiaowei",
                    "type": "MUSIC",
                },
            },
            "play_behavior": "REPLACE_ALL",
        }
        return await self.service.ubus_request(
            device_id,
            "player_play_music",
            "mediaplayer",
            {"startaudioid": audio_id, "music": json.dumps(music)}
        )

    async def _play_playlist_by_music_url(self, device_id: str, tracks: list[dict], audio_id: str = "1582971365183456177") -> bool:
        """使用 player_play_music API 播放播放列表（一次性推送多首）
        
        利用 audio_items 数组支持多首歌曲的特性，让音箱原生管理播放列表切歌。
        """
        import json
        
        if not tracks:
            logger.warning("No tracks to play")
            return False
        
        # 构建 audio_items 数组
        audio_items = []
        for i, track in enumerate(tracks):
            url = track.get("url", "")
            title = track.get("title", "")
            proxied_url = await self._proxy_url_if_needed(url)
            audio_items.append({
                "item_id": {
                    "audio_id": audio_id,
                    "cp": {
                        "album_id": "-1",
                        "episode_index": i,
                        "id": str(355454500 + i),
                        "name": "xiaowei",
                    },
                },
                "stream": {"url": proxied_url},
            })
            logger.info(f"播放列表曲目 {i+1}: {title} -> {proxied_url}")
        
        music = {
            "payload": {
                "audio_type": "MUSIC",
                "audio_items": audio_items,
                "list_params": {
                    "listId": "-1",
                    "loadmore_offset": 0,
                    "origin": "xiaowei",
                    "type": "MUSIC",
                },
            },
            "play_behavior": "REPLACE_ALL",
        }
        
        logger.info(f"推送播放列表到音箱: {len(tracks)} 首")
        
        return await self.service.ubus_request(
            device_id,
            "player_play_music",
            "mediaplayer",
            {"startaudioid": audio_id, "music": json.dumps(music)}
        )

    async def _proxy_url_if_needed(self, url: str) -> str:
        """若 URL 指向 localhost/127.0.0.1，则改为走 mi 自身的 HTTP 服务代理。

        小爱音箱在局域网内无法把 desktop 的 localhost 解析到正确主机，
        通过代理让 mi 服务去 desktop 拉流，再用自己的 IP 暴露给音箱。
        """
        try:
            parsed = urllib.parse.urlparse(url)
            host = (parsed.hostname or "").lower()
            if host not in ("localhost", "127.0.0.1", "::1"):
                return url
            if not self._http_base:
                await self._setup_http_base()
            base = self._http_base[: -len("/music")] if self._http_base.endswith("/music") else self._http_base
            proxy_path = f"/api/proxy?url={urllib.parse.quote(url, safe='')}"
            return f"{base}{proxy_path}"
        except Exception as e:
            logger.warning(f"proxy_url_if_needed fallback to original: {e}")
            return url

    async def play_playlist(self, device_id: str, tracks: list[dict], start_index: int = 0) -> bool:
        """播放播放列表：从指定索引开始

        根据音箱硬件型号选择播放策略：
        - 使用 player_play_music API 的型号：一次性推送 audio_items 数组，让音箱原生管理切歌
        - 其他型号：使用定时器自动切歌（player_play_url 不支持多首）

        Args:
            device_id: 音箱设备 ID
            tracks: 歌曲列表，每项包含 {url, title, duration}
            start_index: 开始播放的索引，默认 0
        """
        if not self.service or not device_id or not tracks:
            logger.warning("Service/device_id/tracks not available")
            return False

        # 取消之前的播放列表定时器
        self._cancel_playlist_timer()

        # 设置播放列表状态
        self._playlist = tracks
        self._playlist_index = start_index
        self._playlist_device_id = device_id

        logger.info(f"开始播放列表: {len(tracks)} 首, 从索引 {start_index} 开始")

        # 获取设备硬件型号
        hardware = self._get_device_hardware(device_id)
        
        # 使用 player_play_music API 的型号：一次性推送多首，音箱原生切歌
        if hardware in _USE_PLAY_MUSIC_API:
            logger.info(f"设备 {hardware} 使用 player_play_music 播放列表")
            try:
                await self.stop(device_id)
                await asyncio.sleep(0.3)
                
                # 从 start_index 开始的曲目
                tracks_to_play = tracks[start_index:]
                success = await self._play_playlist_by_music_url(device_id, tracks_to_play)
                if success:
                    logger.info(f"播放列表已推送到音箱: {len(tracks_to_play)} 首")
                    return True
                else:
                    logger.warning("player_play_music 播放列表失败，回退到定时器模式")
            except Exception as e:
                logger.error(f"player_play_music 播放列表失败: {e}", exc_info=True)
        
        # 其他型号或 player_play_music 失败：使用定时器自动切歌
        logger.info(f"使用定时器模式播放列表")
        return await self._play_playlist_track()

    async def _play_playlist_track(self) -> bool:
        """播放播放列表中当前索引的歌曲，并设置定时器切下一首（定时器模式）"""
        if not self._playlist or self._playlist_index >= len(self._playlist):
            logger.info("播放列表已结束")
            return True

        track = self._playlist[self._playlist_index]
        device_id = self._playlist_device_id
        if not device_id:
            return False

        url = track.get("url", "")
        title = track.get("title", "")
        duration = track.get("duration", 0)

        logger.info(f"播放列表 [{self._playlist_index + 1}/{len(self._playlist)}]: {title}")

        # 播放当前歌曲
        success = await self.play_by_url(device_id, url, title)
        if not success:
            logger.warning(f"播放列表第 {self._playlist_index} 首播放失败，尝试下一首")
            self._playlist_index += 1
            return await self._play_playlist_track()

        # 设置定时器自动切下一首（根据歌曲时长 + 2秒缓冲）
        if duration and duration > 0:
            delay = duration + 2.0
            logger.info(f"{delay:.1f} 秒后自动播放下一首")
            self._playlist_timer = asyncio.create_task(self._playlist_auto_next(delay))
        else:
            # 没有时长信息，不自动切歌
            logger.info("歌曲时长未知，不自动切歌")

        return True

    async def _playlist_auto_next(self, delay: float):
        """定时器：延迟后播放下一首"""
        try:
            await asyncio.sleep(delay)
            if self._playlist and self._playlist_device_id:
                self._playlist_index += 1
                if self._playlist_index < len(self._playlist):
                    await self._play_playlist_track()
                else:
                    logger.info("播放列表播放完毕")
                    self._clear_playlist()
        except asyncio.CancelledError:
            logger.info("播放列表定时器被取消")
        except Exception as e:
            logger.error(f"自动切歌失败: {e}")

    def _cancel_playlist_timer(self):
        """取消播放列表定时器"""
        if self._playlist_timer:
            self._playlist_timer.cancel()
            self._playlist_timer = None
            logger.info("播放列表定时器已取消")

    def _clear_playlist(self):
        """清空播放列表状态"""
        self._playlist = []
        self._playlist_index = 0
        self._playlist_device_id = None
        self._cancel_playlist_timer()

    async def stop(self, device_id: str) -> bool:
        """停止播放（同时取消播放列表自动切歌）"""
        if not self.service or not device_id:
            return False
        try:
            # 如果是当前播放列表的设备，取消播放列表定时器
            if device_id == self._playlist_device_id:
                self._clear_playlist()
                
            result = await self.service.ubus_request(
                device_id,
                "player_play_operation",
                "mediaplayer",
                {"action": "stop", "media": "app_ios"}
            )
            if result:
                logger.info(f"Stopped playback on {device_id}")
            return bool(result)
        except Exception as e:
            logger.warning(f"Stop failed: {e}")
            return False

    async def pause(self, device_id: str) -> bool:
        """暂停播放"""
        if not self.service or not device_id:
            return False
        try:
            result = await self.service.ubus_request(
                device_id,
                "player_play_operation",
                "mediaplayer",
                {"action": "pause", "media": "app_ios"}
            )
            if result:
                logger.info(f"Paused playback on {device_id}")
            return bool(result)
        except Exception as e:
            logger.warning(f"Pause failed: {e}")
            return False

    async def tts(self, device_id: str, text: str) -> bool:
        """TTS 播报文本"""
        if not self.service or not device_id:
            return False
        try:
            await self.service.text_to_speech(device_id, text)
            logger.info(f"TTS on {device_id}: {text}")
            return True
        except Exception as e:
            logger.warning(f"TTS failed: {e}")
            return False

    async def close(self) -> None:
        """关闭 aiohttp session"""
        if self._session:
            await self._session.close()
            logger.info("aiohttp session closed")

    def _schedule_auto_next(self, duration: float, device_id: str) -> None:
        """设置自动切歌定时器"""
        if self._auto_next_timer:
            self._auto_next_timer.cancel()

        delay = duration + 1.0
        logger.info(f"Auto-next scheduled in {delay:.1f}s")

    def cancel_auto_next(self) -> None:
        """取消自动切歌定时器"""
        if self._auto_next_timer:
            self._auto_next_timer.cancel()
            self._auto_next_timer = None
