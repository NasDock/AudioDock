import aiohttp
import json
import base64
from typing import Dict, Any
from .base import BaseTTS

class VolcTTS(BaseTTS):
    """
    火山引擎 (豆包/TTS) 适配器实现
    """
    
    API_URL = "https://openspeech.bytedance.com/api/v1/tts"

    async def check_credentials(self) -> bool:
        """
        简单的凭据校验逻辑
        """
        api_key = self.config.get("api_key")
        app_id = self.config.get("app_id")
        return bool(api_key and app_id)

    async def synthesize(self, text: str, output_path: str, voice: str) -> bool:
        """
        调用火山引擎 WebAPI 进行合成
        """
        api_key = self.config.get("api_key")
        app_id = self.config.get("app_id")
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "app": {
                "appid": app_id,
                "token": api_key,
                "cluster": "volcano_tts"
            },
            "user": {
                "uid": "novel_tts_pro_user"
            },
            "audio": {
                "voice_type": voice,
                "encoding": "mp3",
                "speed_ratio": 1.0,
                "volume_ratio": 1.0,
                "pitch_ratio": 1.0,
            },
            "request": {
                "reqid": "task_id_placeholder", # 实际应该传入任务ID
                "text": text,
                "text_type": "plain",
                "operation": "query"
            }
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.API_URL, headers=headers, json=payload) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("code") == 3000:
                            audio_data = base64.b64decode(data["data"])
                            with open(output_path, "wb") as f:
                                f.write(audio_data)
                            return True
                        else:
                            print(f"Volc Error: {data.get('message')}")
                    else:
                        print(f"HTTP Error: {response.status}")
        except Exception as e:
            print(f"Volc TTS Synthesis Exception: {e}")
            
        return False
