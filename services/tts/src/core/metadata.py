import os
import shutil
import logging
from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC
from mutagen.mp3 import MP3

logger = logging.getLogger(__name__)

class AudioManager:
    """
    音频后处理：元数据写入与归档
    """

    @staticmethod
    def write_id3_tags(file_path: str, title: str, author: str, album: str, cover_image: bytes = None):
        """
        写入 ID3 标签，适配 Emby/Plex/Audiobookshelf
        """
        try:
            audio = MP3(file_path, ID3=ID3)
            try:
                audio.add_tags()
            except Exception:
                pass # Tags already exist

            # TIT2: Title, TPE1: Lead artist, TALB: Album
            audio.tags.add(TIT2(encoding=3, text=title))
            audio.tags.add(TPE1(encoding=3, text=author))
            audio.tags.add(TALB(encoding=3, text=album))

            if cover_image:
                audio.tags.add(APIC(
                    encoding=3,
                    mime='image/jpeg',
                    type=3, # Cover (front)
                    desc='Front cover',
                    data=cover_image
                ))
            
            audio.save()
            logger.info(f"Successfully wrote ID3 tags for: {file_path}")
        except Exception as e:
            logger.error(f"Failed to write ID3 tags for {file_path}: {e}")

    @staticmethod
    def atomic_move_to_library(temp_path: str, output_base: str, author: str, book_name: str, filename: str):
        """
        原子化移动：先确保目录存在，然后瞬间移动文件
        目录结构: /Output/作者名/书名/章节.mp3
        """
        try:
            dest_dir = os.path.join(output_base, author, book_name)
            os.makedirs(dest_dir, exist_ok=True)
            
            dest_path = os.path.join(dest_dir, filename)
            
            # 使用 shutil.move 实现原子操作（在同一文件系统内是原子的）
            shutil.move(temp_path, dest_path)
            logger.info(f"Atomic move completed: {dest_path}")
            return dest_path
        except Exception as e:
            logger.error(f"Failed to move file to library: {e}")
            raise
