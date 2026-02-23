import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { LlmService } from '../services/llm.service';

@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Post('chat')
  async chat(@Body() body: { messages: { role: 'user' | 'system' | 'assistant', content: string }[] }) {
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HttpException('Messages array is required and cannot be empty.', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.llmService.chat(body.messages);
      return { success: true, data: result };
    } catch (e) {
      throw new HttpException(e.message || 'LLM API request failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
