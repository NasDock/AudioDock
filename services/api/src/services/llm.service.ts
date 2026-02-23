import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { igniteModel, loadModels, Message } from 'multi-llm-ts';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private modelInst: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initLlm();
  }

  private async initLlm() {
    try {
      const provider = this.configService.get<string>('LLM_PROVIDER') || 'deepseek';
      const modelName = this.configService.get<string>('LLM_MODEL') || 'deepseek-chat';
      const apiKey = this.configService.get<string>('LLM_API_KEY') || '';
      const baseURL = this.configService.get<string>('LLM_BASE_URL') || '';

      if (!apiKey) {
        this.logger.warn(`LLM_API_KEY is not configured for provider ${provider}`);
        return;
      }

      const config: any = { apiKey };
      if (baseURL) {
        config.baseURL = baseURL;
      }

      // Load models from provider
      const models = await loadModels(provider, config);
      const chatModels = models?.chat || [];
      const targetModel = chatModels.find(m => m.id === modelName || m.name === modelName) || chatModels[0];
      
      if (!targetModel) {
        this.logger.error(`Model ${modelName} not found for provider ${provider}`);
        return;
      }

      this.modelInst = igniteModel(provider, targetModel, config);
      this.logger.log(`LLM Model initialized with provider: ${provider}, model: ${modelName}`);
    } catch (e) {
      this.logger.error(`Failed to initialize LLM: ${e.message}`, e.stack);
    }
  }

  public async chat(messages: { role: 'system' | 'user' | 'assistant', content: string }[]): Promise<{prompt: string, text: string}> {
    if (!this.modelInst) {
      throw new Error('LLM Service is not initialized or API Key is missing.');
    }

    const systemPrompt = `### 角色设定
你是一名文本指令识别专家，根据文本提取用户关键意图
### 任务
识别用户的关键指令，包括：
- 上一首
- 下一首
- 暂停
- 播放
- 随机播放
- 播放xxx歌曲
- 播放xxx专辑的歌
- 播放xxx歌手的歌
- 播放歌单xxx
- 播放xxx歌单
### 输出
**必须以严格的 JSON 格式输出，不要包含任何其他额外的文本或 markdown 标记，如果有繁体字请转换为简体字**
输出的 JSON 对象必须包含以下两个字段：
1. \`prompt\`: 识别出的指令键值（例如：next, last, pause, play, random, song_xxx, alum_xxx, arist_xxx, list_xxx）
2. \`text\`: 用于展示给用户的友好回复语句（例如：好的，即将播放xxx的歌）

### 指令映射关系
- 上一首 -> next
- 下一首 -> last
- 暂停 -> pause
- 播放 -> play
- 随机播放 -> random
- 播放xxx歌曲 -> song_xxx 
- 播放xxx专辑的歌 -> alum_xxx
- 播放xxx歌手的歌 -> arist_xxx
- 播放歌单xxx -> list_xxx
- 播放xxx歌单 -> list_xxx

### 注意事项
- 不要输出和指令无关的事
- 用户说暂停吧是值 暂停播放，不是停止上下文
- 返回的结果必须是可以直接被 \`JSON.parse()\` 解析的合法 JSON 字符串。
### 示例
输入：
我想听周杰伦的歌
输出:
{"prompt": "arist_周杰伦", "text": "好的，即将播放周杰伦的歌"}

输入：
暂停播放
输出：
{"prompt": "pause", "text": "好的，已暂停"}
====`;
    const payload = [
      new Message('system', systemPrompt),
      ...messages.map(m => new Message(m.role, m.content)),
    ];
    
    const timeout = Number(this.configService.get<string>('LLM_TIMEOUT')) || 60000;
    const temperature = Number(this.configService.get<string>('LLM_TEMPERATURE')) || 0.7;
    const maxTokens = Number(this.configService.get<string>('LLM_MAX_TOKENS')) || 2048;

    const response = await this.modelInst.complete(payload, {
      timeout,
      temperature,
      maxTokens,
    });

    let content = response.content;
    try {
        // Strip markdown code blocks if the model still outputs them
        if (content.startsWith('\`\`\`json') && content.endsWith('\`\`\`')) {
            content = content.substring(7, content.length - 3).trim();
        } else if (content.startsWith('\`\`\`') && content.endsWith('\`\`\`')) {
            content = content.substring(3, content.length - 3).trim();
        }
        const parsed = JSON.parse(content);
        return parsed;
    } catch (e) {
        this.logger.error("Failed to parse LLM JSON response", e);
        return { prompt: "error", text: "意图解析失败：" + content };
    }
  }
}
