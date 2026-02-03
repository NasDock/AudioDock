from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseTTS(ABC):
    """
    TTS 引擎抽象基类 (Adapter Pattern)
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config

    @abstractmethod
    async def check_credentials(self) -> bool:
        """
        验证 API 凭据是否有效
        """
        pass

    @abstractmethod
    async def synthesize(self, text: str, output_path: str, voice: str) -> bool:
        """
        语音合成接口
        :param text: 待合成文本
        :param output_path: 目标音频保存路径
        :param voice: 发音人ID/角色
        :return: 是否成功
        """
        pass
