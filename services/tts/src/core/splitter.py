import re
import chardet
import os
from typing import List, Dict

class NovelSplitter:
    """
    智能小说分章节工具
    """
    # 常用章节匹配正则
    CHAPTER_PATTERNS = [
        r'(第[一二三四五六七八九十百千万\d]+[章节回卷])\s*(.*)',
        r'(Chapter\s*\d+)\s*(.*)',
        r'(序[章回]|楔子|引子|内容简介|作者的话)'
    ]

    @staticmethod
    def detect_encoding(file_path: str) -> str:
        with open(file_path, 'rb') as f:
            raw_data = f.read(10000)
            result = chardet.detect(raw_data)
            return result['encoding'] or 'utf-8'

    def split_by_chapters(self, file_path: str) -> List[Dict[str, str]]:
        """
        根据正则分章，并自动识别编码
        """
        encoding = self.detect_encoding(file_path)
        with open(file_path, 'r', encoding=encoding, errors='ignore') as f:
            content = f.read()

        combined_pattern = '|'.join(self.CHAPTER_PATTERNS)
        regex = re.compile(combined_pattern, re.IGNORECASE)

        chapters = []
        matches = list(regex.finditer(content))
        
        if not matches:
            # 如果没找到章节，按字数粗略切分（兜底）
            chunk_size = 5000
            for i in range(0, len(content), chunk_size):
                chapters.append({
                    "title": f"第{i // chunk_size + 1}部分",
                    "content": content[i:i + chunk_size]
                })
            return chapters

        for i in range(len(matches)):
            start_pos = matches[i].start()
            end_pos = matches[i+1].start() if i + 1 < len(matches) else len(content)
            
            title = matches[i].group(0).strip()
            # 过滤掉标题，取正文
            body = content[start_pos:end_pos].strip()
            
            chapters.append({
                "title": title,
                "content": body
            })
            
        return chapters

    def extract_metadata(self, file_path: str) -> Dict[str, str]:
        """
        从文件头尝试提取书名和作者
        """
        encoding = self.detect_encoding(file_path)
        # 尝试去掉 UUID 前缀 (36字符 + _)
        filename = os.path.basename(file_path).replace(".txt", "")
        if len(filename) > 37 and filename[36] == '_' and re.match(r'[0-9a-f-]{36}', filename[:36]):
            clean_title = filename[37:]
        else:
            clean_title = filename

        metadata = {"title": clean_title, "author": "Unknown"}
        
        try:
            with open(file_path, 'r', encoding=encoding, errors='ignore') as f:
                # 只读前 50 行
                for _ in range(50):
                    line = f.readline().strip()
                    if not line: continue
                    
                    author_match = re.search(r'作者[:：]\s*(.*)', line)
                    if author_match:
                        metadata["author"] = author_match.group(1).strip()
                    
                    title_match = re.search(r'书名[:：]\s*(.*)', line)
                    if title_match:
                        metadata["title"] = title_match.group(1).strip()
        except Exception:
            pass
            
        return metadata
