"""小爱音箱 SQLite 存储层

三张表：
- wake_keywords: 唤醒关键字（DB 优先，env VOICE_KEYWORDS 仅作首次种子）
- conversation_history: 对话历史（voice_listener 轮询时自动落库）
- cast_history: 投放历史（play_by_url / play_playlist / voice 埋点）

使用内置 sqlite3（同步、依赖最小化），所有 DB 操作应通过 asyncio.to_thread 调用。
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time

from src.config import Config

logger = logging.getLogger(__name__)

DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DB_PATH = os.path.join(DB_DIR, "xiaoai.db")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wake_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  timestamp_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(device_id, timestamp_ms, query)
);
CREATE INDEX IF NOT EXISTS idx_conv_ts ON conversation_history(timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_conv_device ON conversation_history(device_id);
CREATE TABLE IF NOT EXISTS cast_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  tracks_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cast_ts ON cast_history(created_at DESC);
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
"""


def _now_ms() -> int:
    return int(time.time() * 1000)


# kv_store 建表兜底：MiQRAuth 在模块 import 阶段（init_db 之前）就可能读库，
# 因此 kv 操作自带建表，保证任意时序下都可用。
_kv_ready = False


def _ensure_kv_table(conn: sqlite3.Connection) -> None:
    global _kv_ready
    if not _kv_ready:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS kv_store ("
            "key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
        )
        conn.commit()
        _kv_ready = True


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(DB_DIR, exist_ok=True)
        _conn = sqlite3.Connection(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def init_db() -> None:
    """建表 + 种子唤醒词（首次启动且表为空时写入 env VOICE_KEYWORDS）"""
    with _lock:
        conn = _get_conn()
        conn.executescript(_SCHEMA)

        # 种子唤醒词：表为空时从 env 写入
        row = conn.execute("SELECT COUNT(*) AS cnt FROM wake_keywords").fetchone()
        if row["cnt"] == 0 and Config.VOICE_KEYWORDS:
            now = _now_ms()
            for kw in Config.VOICE_KEYWORDS:
                conn.execute(
                    "INSERT OR IGNORE INTO wake_keywords (keyword, enabled, created_at, updated_at) VALUES (?, 1, ?, ?)",
                    (kw, now, now),
                )
            conn.commit()
            logger.info(f"[db] 种子唤醒词已写入: {Config.VOICE_KEYWORDS}")

    logger.info(f"[db] SQLite 初始化完成: {DB_PATH}")


# ===================== KV 存储（登录凭证等） =====================


def get_kv(key: str) -> str | None:
    """读取 KV 值，不存在返回 None"""
    with _lock:
        conn = _get_conn()
        _ensure_kv_table(conn)
        row = conn.execute("SELECT value FROM kv_store WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_kv(key: str, value: str) -> None:
    """写入/覆盖 KV 值"""
    with _lock:
        conn = _get_conn()
        _ensure_kv_table(conn)
        conn.execute(
            "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, _now_ms()),
        )
        conn.commit()


def delete_kv(key: str) -> None:
    with _lock:
        conn = _get_conn()
        _ensure_kv_table(conn)
        conn.execute("DELETE FROM kv_store WHERE key = ?", (key,))
        conn.commit()


# ===================== 唤醒关键字 =====================


def list_keywords() -> list[dict]:
    with _lock:
        rows = _get_conn().execute(
            "SELECT id, keyword, enabled, created_at, updated_at FROM wake_keywords ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


def add_keyword(keyword: str) -> dict | None:
    """新增唤醒词，已存在返回 None"""
    keyword = keyword.strip()
    if not keyword:
        return None
    now = _now_ms()
    with _lock:
        conn = _get_conn()
        try:
            cur = conn.execute(
                "INSERT INTO wake_keywords (keyword, enabled, created_at, updated_at) VALUES (?, 1, ?, ?)",
                (keyword, now, now),
            )
            conn.commit()
            return {
                "id": cur.lastrowid,
                "keyword": keyword,
                "enabled": True,
                "created_at": now,
                "updated_at": now,
            }
        except sqlite3.IntegrityError:
            return None


def update_keyword(kw_id: int, keyword: str | None = None, enabled: bool | None = None) -> bool:
    """更新唤醒词（改词或启用/禁用），返回是否找到记录"""
    with _lock:
        conn = _get_conn()
        sets: list[str] = ["updated_at = ?"]
        params: list = [_now_ms()]
        if keyword is not None:
            sets.append("keyword = ?")
            params.append(keyword.strip())
        if enabled is not None:
            sets.append("enabled = ?")
            params.append(1 if enabled else 0)
        params.append(kw_id)
        cur = conn.execute(
            f"UPDATE wake_keywords SET {', '.join(sets)} WHERE id = ?", params
        )
        conn.commit()
        return cur.rowcount > 0


def delete_keyword(kw_id: int) -> bool:
    with _lock:
        cur = _get_conn().execute("DELETE FROM wake_keywords WHERE id = ?", (kw_id,))
        _get_conn().commit()
        return cur.rowcount > 0


def enabled_keywords() -> list[str]:
    """返回启用的唤醒词，按长度降序（最长匹配优先）"""
    with _lock:
        rows = _get_conn().execute(
            "SELECT keyword FROM wake_keywords WHERE enabled = 1 ORDER BY LENGTH(keyword) DESC"
        ).fetchall()
        return [r["keyword"] for r in rows]


# ===================== 对话历史 =====================


def insert_conversation(
    device_id: str,
    device_name: str,
    query: str,
    answer: str,
    request_id: str,
    timestamp_ms: int,
) -> bool:
    """插入对话记录，重复（device_id + timestamp_ms + query）时忽略，返回是否新插入"""
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT OR IGNORE INTO conversation_history "
            "(device_id, device_name, query, answer, request_id, timestamp_ms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (device_id, device_name, query, answer, request_id, timestamp_ms, _now_ms()),
        )
        conn.commit()
        return cur.rowcount > 0


def list_conversations(
    page: int = 1,
    size: int = 20,
    device_id: str | None = None,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> tuple[list[dict], int]:
    """分页查询对话历史，返回 (items, total)"""
    where: list[str] = []
    params: list = []
    if device_id:
        where.append("device_id = ?")
        params.append(device_id)
    if start_ms is not None:
        where.append("timestamp_ms >= ?")
        params.append(start_ms)
    if end_ms is not None:
        where.append("timestamp_ms <= ?")
        params.append(end_ms)

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with _lock:
        conn = _get_conn()
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM conversation_history {where_sql}", params
        ).fetchone()["cnt"]

        offset = (page - 1) * size
        rows = conn.execute(
            f"SELECT * FROM conversation_history {where_sql} "
            f"ORDER BY timestamp_ms DESC LIMIT ? OFFSET ?",
            params + [size, offset],
        ).fetchall()

        return [dict(r) for r in rows], total


# ===================== 投放历史 =====================


def insert_cast(
    device_id: str,
    device_name: str,
    title: str,
    url: str,
    source: str,
    tracks_count: int = 1,
) -> int:
    """插入投放记录，返回 rowid"""
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO cast_history "
            "(device_id, device_name, title, url, source, tracks_count, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (device_id, device_name, title, url, source, tracks_count, _now_ms()),
        )
        conn.commit()
        return cur.lastrowid or 0


def list_casts(
    page: int = 1,
    size: int = 20,
    device_id: str | None = None,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> tuple[list[dict], int]:
    """分页查询投放历史，返回 (items, total)"""
    where: list[str] = []
    params: list = []
    if device_id:
        where.append("device_id = ?")
        params.append(device_id)
    if start_ms is not None:
        where.append("created_at >= ?")
        params.append(start_ms)
    if end_ms is not None:
        where.append("created_at <= ?")
        params.append(end_ms)

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with _lock:
        conn = _get_conn()
        total = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM cast_history {where_sql}", params
        ).fetchone()["cnt"]

        offset = (page - 1) * size
        rows = conn.execute(
            f"SELECT * FROM cast_history {where_sql} "
            f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [size, offset],
        ).fetchall()

        return [dict(r) for r in rows], total
