// Клиент OpenAI-совместимого API без сети: локальный HTTP-сервер изображает
// POST /v1/chat/completions (spec/tech/architecture.md, раздел 6).
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { test } = require('node:test');
const { FilterRefusal, openAiCompatible } = require('../dist/llm/llm.service.js');

const messages = [{ role: 'system', content: 'Правила' }, { role: 'user', content: 'Вопрос' }];
const reply = (content, finishReason = 'stop') => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
});

// Поддельный сервис: запоминает запросы и передаёт их в handle.
async function fakeService(t, handle) {
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const call = { url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    calls.push(call);
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    await handle(call, send);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { calls, base: `http://127.0.0.1:${server.address().port}/v1` };
}

test('Запрос уходит на <LLM_BASE_URL>/chat/completions с ключом в Bearer и моделью', async (t) => {
  const { calls, base } = await fakeService(t, (call, send) => send(200, reply('Ответ [DEMO-001]')));
  const complete = openAiCompatible(`${base}/`, 'deepseek-ai/DeepSeek-V4-Flash', 2000, 'secret-value');
  assert.equal(await complete(messages), 'Ответ [DEMO-001]');
  assert.equal(calls[0].url, '/v1/chat/completions');
  assert.equal(calls[0].headers.authorization, 'Bearer secret-value');
  assert.deepEqual(calls[0].body, { model: 'deepseek-ai/DeepSeek-V4-Flash', messages });
});

test('Без ключа заголовок Authorization не отправляется (локальный Ollama)', async (t) => {
  const { calls, base } = await fakeService(t, (call, send) => send(200, reply('Ответ')));
  await openAiCompatible(base, 'qwen2.5:7b', 2000)(messages);
  assert.equal(calls[0].headers.authorization, undefined);
});

test('Ошибки провайдера, фильтр, пустой ответ и таймаут дают понятные сообщения', async (t) => {
  const { base } = await fakeService(t, async ({ body }, send) => {
    if (body.model === 'bad-key') send(401, { error: { message: 'Invalid API key secret' } });
    else if (body.model === 'long') send(400, { error: { message: 'x'.repeat(1000) } });
    else if (body.model === 'filter') send(200, reply('', 'content_filter'));
    else if (body.model === 'empty') send(200, reply('   '));
    else if (body.model === 'slow') setTimeout(() => send(200, reply('Поздно')), 500);
  });
  await assert.rejects(openAiCompatible(base, 'bad-key', 2000, 'k')(messages), /^Error: LLM HTTP 401: .*Invalid API key secret/u);
  await assert.rejects(openAiCompatible(base, 'long', 2000, 'k')(messages), (error) => {
    assert.match(error.message, /^LLM HTTP 400: /u);
    assert.ok(error.message.length <= 'LLM HTTP 400: '.length + 300);
    return true;
  });
  await assert.rejects(openAiCompatible(base, 'filter', 2000, 'k')(messages), (error) => {
    assert.ok(error instanceof FilterRefusal);
    assert.match(error.message, /finish_reason: content_filter/u);
    return true;
  });
  await assert.rejects(openAiCompatible(base, 'empty', 2000, 'k')(messages), /Пустой ответ LLM/u);
  await assert.rejects(openAiCompatible(base, 'slow', 100, 'k')(messages), { name: 'TimeoutError' });
});

test('Неверный адрес или пустая модель останавливают запуск', () => {
  assert.throws(() => openAiCompatible('', 'm', 1000), /Проверьте LLM_BASE_URL/u);
  assert.throws(() => openAiCompatible('ftp://example.com/v1', 'm', 1000), /Проверьте LLM_BASE_URL/u);
  assert.throws(() => openAiCompatible('https://foundation-models.api.cloud.ru/v1', ' ', 1000), /Задайте LLM_MODEL/u);
});
