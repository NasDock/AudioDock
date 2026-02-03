import os
import json
import asyncio
from sqlmodel import Session, select
from src.database.models import engine, Task, ChapterTask
from src.core.splitter import NovelSplitter
from src.engines.edge import EdgeTTS
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TRCK

import shutil

class TaskProcessor:
    def __init__(self):
        self.splitter = NovelSplitter()
        # 目前默认使用 EdgeTTS，后续可以根据 task.options 选择引擎
        self.edge_engine = EdgeTTS(config={})

    def _get_output_base(self, base_dir: str):
        """
        根据环境变量获取最终输出根目录
        """
        # 优先读取 AUDIO_BOOK_DIR
        final_dir = os.getenv("AUDIO_BOOK_DIR")
        if final_dir:
            # 如果是相对路径，相对于项目根目录
            if not os.path.isabs(final_dir):
                final_dir = os.path.abspath(os.path.join(base_dir, final_dir))
            return final_dir
        
        # 兜底回到 data/audio
        return os.path.join(base_dir, "data/audio")

    def _write_metadata(self, file_path: str, task: Task, chapter: ChapterTask):
        """
        为生成的 MP3 文件写入元数据
        """
        try:
            audio = MP3(file_path, ID3=ID3)
            # 如果没有 ID3 tag 则添加
            try:
                audio.add_tags()
            except Exception:
                pass
            
            # 设置标签
            audio.tags.add(TIT2(encoding=3, text=chapter.title))  # 标题
            audio.tags.add(TPE1(encoding=3, text=task.author))   # 艺术家
            audio.tags.add(TALB(encoding=3, text=task.book_name)) # 专辑
            audio.tags.add(TRCK(encoding=3, text=str(chapter.index + 1))) # 轨道号
            
            audio.save()
        except Exception as e:
            print(f"Error writing metadata for {file_path}: {e}")

    async def process_task(self, task_id: str):
        """
        处理小说转换任务
        """
        print(f"--- Starting Task Processor for: {task_id} ---")
        
        with Session(engine) as db:
            # ... (前置校验保持不变)
            task = db.get(Task, task_id)
            if not task:
                print(f"Task {task_id} not found")
                return

            if task.status == "completed":
                return

            task.status = "processing"
            db.add(task)
            db.commit()

            if not os.path.exists(task.file_path):
                task.status = "failed"
                db.add(task)
                db.commit()
                print(f"File not found: {task.file_path}")
                return

            chapters_content = self.splitter.split_by_chapters(task.file_path)
            statement = select(ChapterTask).where(ChapterTask.task_id == task_id).order_by(ChapterTask.index)
            chapter_tasks = db.exec(statement).all()

            # 4. 准备目录
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
            
            # 临时目录 (工作目录)
            temp_base = os.path.join(base_dir, "data/temp_audio", task_id)
            os.makedirs(temp_base, exist_ok=True)

            # 最终目录 (根据环境变量 AUDIO_BOOK_DIR)
            output_root = self._get_output_base(base_dir)
            
            safe_book_name = "".join([c for c in task.book_name if c.isalnum() or c in "._- "]).strip()
            if not safe_book_name:
                safe_book_name = task_id
            
            final_output_dir = os.path.join(output_root, safe_book_name)
            os.makedirs(final_output_dir, exist_ok=True)
            print(f"--- Task Output Directory: {final_output_dir} ---")

            options = json.loads(task.options or "{}")
            voice = options.get("voice", "zh-CN-XiaoxiaoNeural")

            completed_count = 0
            
            # 5. 逐个章节转换
            for ct in chapter_tasks:
                db.refresh(task)
                if task.status != "processing":
                    print(f"Task {task_id} status changed to {task.status}, stopping processor.")
                    return

                if ct.status == "done":
                    completed_count += 1
                    continue
                
                try:
                    ct.status = "doing"
                    db.add(ct)
                    db.commit()

                    if ct.index < len(chapters_content):
                        content = chapters_content[ct.index]["content"]
                        clean_title = "".join([c for c in ct.title if c.isalnum() or c in " ()-_. "]).strip()
                        file_name = f"{clean_title}.mp3"
                        
                        # 先在临时目录生成
                        temp_path = os.path.join(temp_base, file_name)
                        final_path = os.path.join(final_output_dir, file_name)

                        # 执行转换
                        success = await self.edge_engine.synthesize(content, temp_path, voice)
                        
                        if success:
                            # 写入元数据 (在临时路径操作)
                            self._write_metadata(temp_path, task, ct)
                            
                            # 原子操作：移动到最终目录
                            shutil.move(temp_path, final_path)
                            
                            ct.status = "done"
                            ct.output_path = final_path
                            completed_count += 1
                        else:
                            ct.status = "error"
                            ct.error_msg = "TTS synthesis failed"
                    else:
                        ct.status = "error"
                        ct.error_msg = "Chapter content mismatch"
                    
                except Exception as e:
                    ct.status = "error"
                    ct.error_msg = str(e)
                    print(f"Error processing chapter {ct.index}: {e}")

                task.completed_chapters = completed_count
                db.add(ct)
                db.add(task)
                db.commit()

            # 6. 后期清理
            if os.path.exists(temp_base) and not os.listdir(temp_base):
                os.rmdir(temp_base)

            # 7. 标记任务完成
            db.refresh(task)
            if task.status == "processing": # 只有在还在处理中时才更新最终状态
                if completed_count == task.total_chapters:
                    task.status = "completed"
                else:
                    task.status = "failed"
                db.add(task)
                db.commit()
            print(f"--- Task {task_id} finished with status: {task.status} ---")

# 全局处理器实例
processor = TaskProcessor()
