from typing import Optional, Dict, List
from sqlmodel import SQLModel, Field, JSON, Column, create_engine, Session
from datetime import datetime
import uuid
import os

# ---------------------------------------------------------
# 数据库连接配置 (指向 Prisma 的 SQLite 文件)
# ---------------------------------------------------------
# 优先从环境变量获取 DATABASE_URL (Prisma 使用的格式: file:/path/to/db)
database_url_env = os.getenv("DATABASE_URL")

if database_url_env and database_url_env.startswith("file:"):
    # 将 file:/path/to/db 转换为 sqlite:////path/to/db
    sqlite_path = database_url_env.replace("file:", "")
    if os.name == 'nt':
        sqlite_url = f"sqlite:///{sqlite_path.lstrip('/')}"
    else:
        sqlite_url = f"sqlite:////{sqlite_path.lstrip('/')}"
else:
    # 兜底计算逻辑
    DB_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
    SQLITE_FILE = os.path.join(DB_ROOT, "packages/db/prisma/dev.db")
    
    if os.name == 'nt': # Windows
        normalized_path = SQLITE_FILE.replace('\\', '/')
        sqlite_url = f"sqlite:///{normalized_path}"
    else:
        sqlite_url = f"sqlite:////{SQLITE_FILE}"

print(f"--- TTS Connecting to DB: {sqlite_url} ---")

engine = create_engine(sqlite_url, echo=False)

def get_session():
    with Session(engine) as session:
        yield session

# ---------------------------------------------------------
# 模型定义 (与 Prisma schema 保持一致)
# ---------------------------------------------------------

class UserConfig(SQLModel, table=True):
    """
    保存用户配置（如 API Key）
    """
    __tablename__ = "tts_user_config"
    id: Optional[int] = Field(default=None, primary_key=True)
    engine_name: str = Field(index=True) # edge, volc, ali, openai
    config_json: str # 实际应用中应为加密后的配置
    updated_at: datetime = Field(default_factory=datetime.now)

class Task(SQLModel, table=True):
    """
    转换任务队列
    """
    __tablename__ = "tts_task"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    book_name: str = Field(index=True)
    author: str = Field(index=True)
    file_path: str = Field(default="")
    total_chapters: int
    completed_chapters: int = 0
    status: str = Field(default="pending") # pending, processing, completed, failed
    created_at: datetime = Field(default_factory=datetime.now)
    # 额外选项，如语速、音色ID，Prisma 中存为 String
    options: Optional[str] = None

class ChapterTask(SQLModel, table=True):
    """
    具体章节转换任务
    """
    __tablename__ = "tts_chapter_task"
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: str = Field(foreign_key="tts_task.id")
    index: int
    title: str
    status: str = "pending" # pending, doing, done, error
    error_msg: Optional[str] = None
    output_path: Optional[str] = None
