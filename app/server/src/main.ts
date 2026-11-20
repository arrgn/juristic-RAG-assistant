import 'reflect-metadata';
import { Body, Controller, Get, HttpCode, Inject, Module, Post, UnprocessableEntityException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { ChatRequest, ChatService, ChatTrace } from './chat/chat.service.js';
import { codes, loadCorpus, Scope } from './corpus/corpus.js';
import { openAiCompatible } from './llm/llm.service.js';
import { SearchService } from './search/search.service.js';

function choice<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const value = process.env[key] ?? fallback;
  const selected = values.find((candidate) => candidate === value);
  if (!selected) throw new Error(`Недопустимое значение ${key}`);
  return selected;
}

function setting(key: string, fallback: number, min: number, integer = true): number {
  const raw = process.env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (raw?.trim() === '' || !Number.isFinite(value) || value < min || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`Недопустимое значение ${key}`);
  }
  return value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseRequest(body: unknown): ChatRequest {
  const fields = object(body);
  const message = typeof fields?.message === 'string' ? fields.message.trim() : '';
  const scope: unknown = fields?.scope === undefined ? 'all' : fields.scope;
  const history: unknown = fields?.history === undefined ? [] : fields.history;
  const problems: string[] = [];
  if (message.length < 3 || message.length > 1000 || (message.match(/[\p{L}\p{N}]+/gu) ?? []).length < 3) {
    problems.push('message: от 3 до 1000 символов и не менее 3 слов');
  }
  if (scope !== 'all' && !codes.some((code) => code === scope)) problems.push('scope: неизвестный источник');
  const validHistory = Array.isArray(history) && history.length <= 10 && history.every((value: unknown) => {
    const item = object(value);
    return (item?.role === 'user' || item?.role === 'assistant')
      && typeof item.content === 'string' && item.content.length <= 4000;
  });
  if (!validHistory) problems.push('history: максимум 10 сообщений с ролью user или assistant и текстом до 4000 символов');
  if (problems.length) throw new UnprocessableEntityException(problems);

  return {
    message,
    scope: scope as Scope,
    history: (history as ChatRequest['history']).map(({ role, content }) => ({ role, content })),
  };
}

export async function createApp(trace?: (event: ChatTrace) => void) {
  const mode = choice('CORPUS_MODE', ['demo', 'official'], 'demo');
  const provider = choice('LLM_PROVIDER', ['stub', 'openai_compatible'], 'stub');
  const demo = mode === 'demo';
  const corpusPath = process.env.CORPUS_PATH ?? join(__dirname, '..', 'data', demo ? 'demo/articles.json' : 'articles.json');
  const search = new SearchService(loadCorpus(corpusPath, demo));
  const complete = provider === 'stub' ? undefined : openAiCompatible(
    process.env.LLM_BASE_URL ?? '',
    process.env.LLM_MODEL ?? '',
    setting('LLM_TIMEOUT_MS', 30000, 1),
    process.env.LLM_API_KEY,
  );
  const chat = new ChatService(
    search, complete,
    setting('MAX_CONTEXT_DOCS', 5, 1),
    setting('MIN_SCORE', 0, 0, false),
    setting('LLM_CONTEXT_BYTES', 24000, 2048),
    trace,
  );

  @Controller()
  class ApiController {
    constructor(@Inject(ChatService) private readonly service: ChatService) {}

    @Get('health')
    health() {
      return { status: 'ok', version: '0.1.0', llm: provider };
    }

    @Post('chat')
    @HttpCode(200)
    answer(@Body() body: unknown) {
      return this.service.answer(parseRequest(body));
    }
  }

  @Module({
    controllers: [ApiController],
    providers: [{ provide: ChatService, useValue: chat }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  return app;
}

async function bootstrap() {
  const port = setting('SERVER_PORT', 3000, 1);
  const app = await createApp();
  await app.listen(port);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Ошибка запуска сервера');
    process.exitCode = 1;
  });
}
