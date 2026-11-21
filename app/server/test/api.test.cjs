// Проверка контракта API через HTTP (spec/tech/architecture.md, раздел 5).
// Сервер работает на демо-корпусе, модель заменена заглушкой или локальным
// HTTP-сервером: сеть и настоящая LLM не нужны.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { Logger } = require('@nestjs/common');
const { createApp } = require('../dist/main.js');
const { notFound } = require('../dist/chat/chat.service.js');
const { disclaimer } = require('../dist/llm/prompts.js');

Logger.overrideLogger(false);

const question = 'Как защитить тайну переписки?';

// Все настройки сервера пустые: так их передаёт docker compose, если в .env ничего не задано.
const blank = Object.fromEntries([
  'CORPUS_MODE', 'CORPUS_PATH', 'MAX_CONTEXT_DOCS', 'MIN_SCORE', 'LLM_PROVIDER', 'LLM_BASE_URL',
  'LLM_MODEL', 'LLM_API_KEY', 'LLM_TIMEOUT_MS', 'LLM_CONTEXT_BYTES',
].map((key) => [key, '']));

async function start(t, settings = {}) {
  const values = { ...blank, ...settings };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  let app;
  try {
    app = await createApp();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
}

async function ask(api, body) {
  const response = await fetch(`${api}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('GET /api/health сообщает статус, версию и провайдера', async (t) => {
  const api = await start(t);
  const response = await fetch(`${api}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.version, 'string');
  assert.equal(body.llm, 'stub');
});

test('POST /api/chat отклоняет неверный запрос кодом 422', async (t) => {
  const api = await start(t);
  const invalid = [
    { message: 'Что  за', scope: 'all', history: [] },
    { message: question, scope: 'tax_code', history: [] },
    { message: question, scope: 'all', history: [{ role: 'system', content: 'Текст' }] },
  ];
  for (const body of invalid) {
    const response = await ask(api, body);
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.equal(response.body.statusCode, 422);
    assert.ok(Array.isArray(response.body.message));
  }
});

test('POST /api/chat отвечает по найденным статьям, дисклеймер — последний абзац', async (t) => {
  const api = await start(t);
  const { status, body } = await ask(api, { message: question, scope: 'all', history: [] });
  assert.equal(status, 200);
  assert.equal(body.sources[0].id, 'DEMO-001');
  for (const field of ['id', 'code', 'article', 'title', 'text', 'source_url', 'score']) {
    assert.ok(field in body.sources[0], field);
  }
  const scores = body.sources.map(({ score }) => score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.match(body.answer, /\[DEMO-001\]/);
  assert.equal(body.answer.split('\n\n').at(-1), disclaimer);
});

test('POST /api/chat без найденных статей возвращает пустой список источников', async (t) => {
  const api = await start(t);
  const { status, body } = await ask(api, { message: question, scope: 'criminal_code', history: [] });
  assert.equal(status, 200);
  assert.deepEqual(body.sources, []);
  // Полный текст этой ветки (с дисклеймером или без) ещё согласуется: spec/tech/rag.md, «Ответ API».
  assert.ok(body.answer.startsWith(notFound));
});

test('POST /api/chat при сбое модели отвечает 200 с пояснением А4 и статьями', async (t) => {
  const llm = createServer((request, response) => {
    request.resume();
    response.writeHead(503).end();
  });
  llm.listen(0, '127.0.0.1');
  await once(llm, 'listening');
  t.after(() => llm.close());
  const api = await start(t, {
    LLM_PROVIDER: 'openai_compatible',
    LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}/v1`,
    LLM_MODEL: 'test',
  });
  const { status, body } = await ask(api, { message: question, scope: 'all', history: [] });
  assert.equal(status, 200);
  assert.match(body.answer, /Пояснение недоступно: языковая модель не ответила\./);
  assert.doesNotMatch(body.answer, /\[[^\]\n]+\]/);
  assert.equal(body.answer.split('\n\n').at(-1), disclaimer);
  assert.equal(body.sources[0].id, 'DEMO-001');
});
