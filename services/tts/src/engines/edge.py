import edge_tts
from .base import BaseTTS

class EdgeTTS(BaseTTS):
    """
    Microsoft Edge TTS 适配器实现 (免费且高质量)
    """

    async def check_credentials(self) -> bool:
        """
        Edge TTS 不需要 API Key，直接返回 True
        """
        return True

    async def synthesize(self, text: str, output_path: str, voice: str) -> bool:
        """
        调用 edge-tts 库进行合成
        """
        try:
            # 过滤掉过短的文本（避免某些解析错误导致只有标点）
            if not text or len(text.strip()) < 1:
                return False

            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(output_path)
            return True
        except Exception as e:
            print(f"Edge TTS Synthesis ERROR [Voice: {voice}]: {e}")
            return False
