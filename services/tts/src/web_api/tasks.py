from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse
import os
import aiofiles
import uuid
import json
from typing import List
from sqlmodel import Session, select
from src.core.splitter import NovelSplitter
from src.database.models import get_session, Task, ChapterTask
from src.core.processor import processor

router = APIRouter()
splitter = NovelSplitter()

# 获取项目根目录 (soundX)
# 当前文件在 services/tts/src/web_api/tasks.py
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
UPLOAD_DIR = os.path.join(BASE_DIR, "services/tts/data/novels")

print(f"--- TTS Upload Dir: {UPLOAD_DIR} ---")

@router.get("/list-files")
async def list_local_files(db: Session = Depends(get_session)):
    """
    列出 TXT_BASE_DIR 目录下的所有 txt 文件，并标记是否已生成任务
    """
    # 优先读取环境变量
    env_txt_dir = os.getenv("TXT_BASE_DIR")
    if env_txt_dir:
        if os.path.isabs(env_txt_dir):
            txt_dir = env_txt_dir
        else:
            # 如果是相对路径，则相对于 BASE_DIR（即项目根目录）解析
            txt_dir = os.path.abspath(os.path.join(BASE_DIR, env_txt_dir))
    else:
        # 默认回退路径
        txt_dir = os.path.join(BASE_DIR, "services/tts/data/novels")
    
    print(f"--- Scanning TXT Dir: {txt_dir} ---")
    
    if not os.path.exists(txt_dir):
        return {"success": True, "files": [], "msg": f"Directory not found: {txt_dir}"}

    files = []
    # 获取数据库中已有的所有文件路径，用于对比
    statement = select(Task.file_path)
    existing_paths = set(db.exec(statement).all())

    for filename in os.listdir(txt_dir):
        if filename.endswith(".txt"):
            full_path = os.path.join(txt_dir, filename)
            files.append({
                "filename": filename,
                "full_path": full_path,
                "is_generated": full_path in existing_paths
            })
    
    return {"success": True, "files": sorted(files, key=lambda x: x['filename'])}

@router.post("/batch-create")
async def batch_create_tasks(
    data: dict, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session)
):
    """
    批量创建任务
    data: {
        "files": [{"full_path": str, "title": str, "author": str, "voice": str}],
        "voice": str  # 默认全局音色
    }
    """
    files = data.get("files", [])
    default_voice = data.get("voice")
    
    if not files or not (default_voice or any(f.get("voice") for f in files)):
        raise HTTPException(status_code=400, detail="Missing files or voice selection")

    created_ids = []
    for f_info in files:
        actual_path = f_info.get("full_path")
        voice = f_info.get("voice") or default_voice
        
        if not actual_path or not voice or not os.path.exists(actual_path):
            continue
        
        # 检查是否已存在（避免重复创建）
        stmt = select(Task).where(Task.file_path == actual_path)
        existing = db.exec(stmt).first()
        if existing:
            continue

        file_id = f_info.get("file_id") or str(uuid.uuid4())
        
        try:
            if not f_info.get("title") or not f_info.get("author"):
                metadata = splitter.extract_metadata(actual_path)
            else:
                metadata = {}

            chapters = splitter.split_by_chapters(actual_path)
            
            new_task = Task(
                id=file_id,
                book_name=f_info.get("title") or metadata.get("title") or os.path.basename(actual_path),
                author=f_info.get("author") or metadata.get("author") or "Unknown",
                file_path=actual_path,
                total_chapters=len(chapters),
                options=json.dumps({"voice": voice})
            )
            db.add(new_task)
            
            for idx, ch in enumerate(chapters):
                chapter_task = ChapterTask(
                    task_id=file_id,
                    index=idx,
                    title=ch["title"],
                    status="pending"
                )
                db.add(chapter_task)
            
            db.commit()
            background_tasks.add_task(processor.process_task, file_id)
            created_ids.append(file_id)
        except Exception as e:
            print(f"Error creating batch task for {actual_path}: {e}")
            db.rollback()

    return {"success": True, "count": len(created_ids), "task_ids": created_ids}

@router.post("/identify-batch")
async def identify_batch(data: dict):
    """
    批量识别文件元数据
    """
    paths = data.get("paths", [])
    results = []
    for p in paths:
        if os.path.exists(p):
            metadata = splitter.extract_metadata(p)
            results.append({
                "full_path": p,
                "filename": os.path.basename(p),
                "title": metadata.get("title") or os.path.basename(p),
                "author": metadata.get("author") or "Unknown"
            })
    return {"success": True, "results": results}

@router.get("/preview")
async def preview_voice(voice: str, text: str = "床前明月光，疑是地上霜。举头望明月，低头思故乡。"):
    """
    试听音色
    """
    cache_dir = os.path.join(BASE_DIR, "services/tts/data/cache")
    os.makedirs(cache_dir, exist_ok=True)
    
    # 使用 voice 命名缓存文件，避免频繁生成
    cache_path = os.path.join(cache_dir, f"preview_{voice}.mp3")
    
    # 如果缓存不存在或者过期（可选），生成它
    if not os.path.exists(cache_path):
        from src.engines.edge import EdgeTTS
        engine = EdgeTTS(config={})
        success = await engine.synthesize(text, cache_path, voice)
        if not success:
            raise HTTPException(status_code=500, detail="Preview synthesis failed")
            
    return FileResponse(cache_path, media_type="audio/mpeg")

@router.get("/voices")
async def get_voices():
    """
    获取可用音色列表 (目前固定返回一些常用的 Edge-TTS 音色)
    """
    return [
        {"label": "晓晓 (女)", "value": "zh-CN-XiaoxiaoNeural"},
        {"label": "晓依 (女)", "value": "zh-CN-XiaoyiNeural"},
        {"label": "云希 (男)", "value": "zh-CN-YunxiNeural"},
        {"label": "云扬 (男)", "value": "zh-CN-YunyangNeural"},
        {"label": "云健 (男)", "value": "zh-CN-YunjianNeural"},
        {"label": "云夏 (男)", "value": "zh-CN-YunxiaNeural"},
        {"label": "东北小蓓 (女)", "value": "zh-CN-liaoning-XiaobeiNeural"},
        {"label": "陕西小妮 (女)", "value": "zh-CN-shaanxi-XiaoniNeural"},
    ]

@router.post("/upload")
async def upload_novel(file: UploadFile = File(...)):
    """
    上传作品接口，返回解析后的章节数和元数据
    """
    if not file.filename.endswith(".txt"):
         raise HTTPException(status_code=400, detail="Only .txt files are allowed")

    file_id = str(uuid.uuid4())
    temp_path = os.path.join(UPLOAD_DIR, f"{file_id}_{file.filename}")
    
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    async with aiofiles.open(temp_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    try:
        metadata = splitter.extract_metadata(temp_path)
        chapters = splitter.split_by_chapters(temp_path)
        
        return {
            "success": True,
            "file_id": file_id,
            "temp_path": temp_path,
            "filename": file.filename,
            "title": metadata.get("title"),
            "author": metadata.get("author"),
            "total_chapters": len(chapters),
            "preview_chapters": [c["title"] for c in chapters[:5]]
        }
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Splitter error: {str(e)}")

@router.post("/create")
async def create_task(
    data: dict, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session)
):
    """
    创建转换任务
    data: {
        "file_id": str,
        "temp_path": str,
        "voice": str,
        "title": str,
        "author": str
    }
    """
    file_id = data.get("file_id")
    temp_path = data.get("temp_path")
    voice = data.get("voice")
    title = data.get("title")
    author = data.get("author")

    if not all([file_id, temp_path, voice]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # 为了安全性，只取文件名，然后重新拼接到当前的 UPLOAD_DIR
    filename = os.path.basename(temp_path)
    actual_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(actual_path):
        # 兜底：如果传入的是全路径且存在也可行，但由于环境不同可能失效
        if not os.path.exists(temp_path):
            raise HTTPException(status_code=404, detail=f"Uploaded file not found: {filename}")
        actual_path = temp_path

    try:
        # 1. 再次切分章节
        chapters = splitter.split_by_chapters(actual_path)
        
        # 2. 创建主任务
        new_task = Task(
            id=file_id,
            book_name=title or "Unknown",
            author=author or "Unknown",
            file_path=actual_path,
            total_chapters=len(chapters),
            options=json.dumps({"voice": voice})
        )
        db.add(new_task)
        
        # 3. 创建章节子任务
        for idx, ch in enumerate(chapters):
            chapter_task = ChapterTask(
                task_id=new_task.id,
                index=idx,
                title=ch["title"],
                status="pending"
            )
            db.add(chapter_task)
            
        db.commit()
        db.refresh(new_task)
        
        # 4. 异步开始处理
        background_tasks.add_task(processor.process_task, new_task.id)
        
        return {"success": True, "task_id": new_task.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{task_id}/pause")
async def pause_task(task_id: str, db: Session = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = "paused"
    db.add(task)
    db.commit()
    return {"success": True}

@router.post("/{task_id}/resume")
async def resume_task(task_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status != "paused" and task.status != "failed":
        raise HTTPException(status_code=400, detail="Only paused or failed tasks can be resumed")
    
    task.status = "processing"
    db.add(task)
    db.commit()
    
    background_tasks.add_task(processor.process_task, task.id)
    return {"success": True}

@router.post("/{task_id}/retry")
async def retry_task(task_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 将所有非完成的章节设置为 pending
    statement = select(ChapterTask).where(ChapterTask.task_id == task_id)
    chapters = db.exec(statement).all()
    for ch in chapters:
        if ch.status != "done":
            ch.status = "pending"
            ch.error_msg = None
            db.add(ch)
            
    task.status = "processing"
    db.add(task)
    db.commit()
    
    background_tasks.add_task(processor.process_task, task.id)
    return {"success": True}

@router.delete("/{task_id}")
async def delete_task(task_id: str, db: Session = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 1. 删除子任务
    statement = select(ChapterTask).where(ChapterTask.task_id == task_id)
    chapters = db.exec(statement).all()
    for ch in chapters:
        db.delete(ch)
        
    # 2. 删除主任务
    db.delete(task)
    
    # 3. 尝试清理输出目录 (可选)
    # import shutil
    # safe_book_name = "".join([c for c in task.book_name if c.isalnum() or c in "._- "]).strip()
    # output_dir = os.path.join(BASE_DIR, "data/audio", safe_book_name)
    # if os.path.exists(output_dir):
    #     shutil.rmtree(output_dir)

    db.commit()
    return {"success": True}

@router.get("/")
async def list_tasks(db: Session = Depends(get_session)):
    """
    获取所有任务列表
    """
    statement = select(Task).order_by(Task.created_at.desc())
    tasks = db.exec(statement).all()
    return {"tasks": tasks}

@router.get("/{task_id}")
async def get_task_detail(task_id: str, db: Session = Depends(get_session)):
    """
    获取单个任务详情及章节进度
    """
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    statement = select(ChapterTask).where(ChapterTask.task_id == task_id).order_by(ChapterTask.index)
    chapters = db.exec(statement).all()
    
    return {
        "task": task,
        "chapters": chapters
    }
