import 'reflect-metadata';
import {
  Body, Controller, Get, HttpCode, HttpException, Inject, Logger, Module, Post, UnprocessableEntityException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { join, resolve } from 'node:path';
import { ChatRequest, ChatService, ChatTrace } from './chat/chat.service.js';
import { codes, loadCorpus, Scope } from './corpus/corpus.js';
import { chatCompletionsUrl, Complete, openAiCompatible } from './llm/llm.service.js';
import { SearchService } from './search/search.service.js';

// Папка app/server: от неё отсчитывается относительный CORPUS_PATH.
const serverRoot = join(__dirname, '..');
const logger = new Logger('Api');

// Пустая переменная окружения равносильна незаданной: docker compose передаёт
// пустые значения для настроек, которых нет в .env.
function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function choice<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const value = env(key) ?? fallback;
  const selected = values.find((candidate) => candidate === value);
  if (!selected) throw new Error(`Недопустимое значение ${key}=${value}; допустимо: ${values.join(', ')}`);
  return selected;
}

function setting(key: string, fallback: number, min: number, integer = true): number {
  const raw = env(key);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isSafeInteger(value))) {
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
  const corpusPath = resolve(serverRoot, env('CORPUS_PATH') ?? join('data', demo ? 'demo/articles.json' : 'articles.json'));
  const articles = loadCorpus(corpusPath, demo);
  const search = new SearchService(articles);
  const timeout = setting('LLM_TIMEOUT_MS', 30000, 1);
  const model = env('LLM_MODEL');
  let complete: Complete | undefined;
  let llm = provider;
  if (provider === 'openai_compatible') {
    const baseUrl = env('LLM_BASE_URL') ?? '';
    const apiKey = env('LLM_API_KEY');
    complete = openAiCompatible(baseUrl, model ?? '', timeout, apiKey);
    llm += ` (${model}, ${chatCompletionsUrl(baseUrl).host})`;
    if (!apiKey) logger.warn('LLM_API_KEY не задан: запросы к модели уйдут без ключа. Так работает только локальный сервер вроде Ollama');
  }
  const chat = new ChatService(
    search, complete,
    setting('MAX_CONTEXT_DOCS', 5, 1),
    setting('MIN_SCORE', 0, 0, false),
    setting('LLM_CONTEXT_BYTES', 24000, 2048),
    (event) => {
      if (event.error) logger.warn(`Модель не ответила: ${event.error}`);
      if (event.rejection) logger.warn(`Пояснение модели отклонено проверкой меток: ${event.rejection}`);
      if (event.modelRefusal) logger.log('Модель ответила, что в найденных статьях недостаточно сведений');
      if (event.filteredOut?.length) logger.warn(`Фильтр модели отклонил запрос; ответ получен без статьи ${event.filteredOut.join(', ')}`);
      trace?.(event);
    },
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
    async answer(@Body() body: unknown) {
      // В журнал попадают только метаданные, без текста вопроса и ответа (architecture.md, раздел 9).
      const started = Date.now();
      let status = 500;
      let sources: number | null = null;
      try {
        const result = await this.service.answer(parseRequest(body));
        status = 200;
        sources = result.sources.length;
        return result;
      } catch (error) {
        if (error instanceof HttpException) status = error.getStatus();
        throw error;
      } finally {
        logger.log(JSON.stringify({ route: 'POST /api/chat', status, duration_ms: Date.now() - started, sources }));
      }
    }
  }

  @Module({
    controllers: [ApiController],
    providers: [{ provide: ChatService, useValue: chat }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  logger.log(`Корпус ${mode}: ${articles.length} статей (${corpusPath}); LLM: ${llm}`);
  return app;
}

async function bootstrap() {
  const port = setting('SERVER_PORT', 3000, 1);
  const app = await createApp();
  // Корректная остановка по SIGTERM от docker compose down.
  app.enableShutdownHooks();
  await app.listen(port);
  logger.log(`Сервер слушает порт ${port}, API — /api`);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Ошибка запуска сервера');
    process.exitCode = 1;
  });
}
