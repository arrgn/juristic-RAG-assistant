const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { test } = require('node:test');
const { Bm25 } = require('../dist/search/bm25.js');
const { SearchService } = require('../dist/search/search.service.js');
const { loadCorpus } = require('../dist/corpus/corpus.js');
const { ChatService, notFound } = require('../dist/chat/chat.service.js');
const { openAiCompatible } = require('../dist/llm/llm.service.js');
const { refusal } = require('../dist/llm/prompts.js');

test('BM25 даёт эталонные баллы и учитывает уникальные токены вопроса', () => {
  const index = new Bm25([
    ['A', 'Возврат оплаты на карту'],
    ['B', 'Статус оплаты в приложении'],
    ['C', 'Возврат билета через кассу'],
  ]);
  const scores = index.score('Как происходит возврат оплаты?');
  assert.equal(scores.get('A').toFixed(6), '0.940007');
  assert.equal(scores.get('B').toFixed(6), '0.470004');
  assert.equal(scores.get('B'), scores.get('C'));
  assert.deepEqual(scores, index.score('Как происходит возврат возврат оплаты?'));
  assert.equal(index.score('библиотека').size, 0);
  assert.equal(new Bm25([]).score('оплаты').size, 0);
});

test('BM25 воспроизводит топ-3 и метрики для вопроса Q03', () => {
  const articles = loadCorpus(join(__dirname, '../data/benchmark/articles.json'));
  const documents = require('../data/benchmark/documents.json');
  const questions = require('../data/benchmark/questions.json');
  const question = questions.find(({ id }) => id === 'Q03');
  assert.ok(question, 'В контрольном наборе должен быть вопрос Q03');

  const documentIdByArticle = new Map(
    documents.map(({ article_id, document_id }) => [article_id, document_id]),
  );
  const search = new SearchService(articles);
  const top3 = search.retrieve(question.question, question.scope, 3, 0)
    .map(({ article }) => documentIdByArticle.get(article.id));
  const relevant = new Set(question.relevant_document_ids);

  assert.deepEqual([...relevant].sort(), ['D07', 'D08', 'D09']);
  assert.deepEqual(top3, ['D09', 'D03', 'D10']);

  const matched = top3.filter((id) => relevant.has(id));
  const firstRelevantRank = top3.findIndex((id) => relevant.has(id)) + 1;
  assert.equal(matched.length / relevant.size, 1 / 3);
  assert.equal(1 / firstRelevantRank, 1);
});

const articles = loadCorpus('data/demo/articles.json', true);
const search = new SearchService(articles);
const request = { message: 'Как защитить тайну переписки?', scope: 'constitution', history: [] };

test('Чат передаёт найденный текст модели и проверяет ссылки', async () => {
  let calls = 0;
  const provider = async (messages) => {
    calls++;
    assert.equal(messages[0].role, 'system');
    const { question, context } = JSON.parse(messages.at(-1).content);
    assert.equal(question, request.message);
    assert.deepEqual(context.map(({ label }) => label), ['[DEMO-001]']);
    assert.equal(context[0].text, articles[0].text);
    return 'Вымышленное пояснение [DEMO-001]';
  };
  const chat = new ChatService(search, provider, 5, 0, 24000);
  const answer = await chat.answer(request);
  assert.equal(answer.sources[0].text, articles[0].text);
  assert.match(answer.answer, /\[DEMO-001\]/);
  assert.match(answer.answer, /^Демонстрационные данные/);
  const empty = await chat.answer({ ...request, scope: 'criminal_code' });
  assert.deepEqual(empty.sources, []);
  assert.ok(empty.answer.startsWith(notFound));
  assert.equal(calls, 1);
  const bad = new ChatService(search, async () => 'Вымышленное пояснение [DEMO-009]', 5, 0, 24000);
  assert.ok((await bad.answer(request)).answer.includes(refusal));
});

test('OpenAI-совместимый провайдер вызывает chat/completions и обрабатывает ошибку', async (t) => {
  const http = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    if (body.model === 'broken') {
      res.writeHead(503).end();
      return;
    }
    assert.equal(body.model, 'test');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Тест [DEMO-001]' } }] }));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => http.close());
  const base = `http://127.0.0.1:${http.address().port}/v1`;
  const chat = new ChatService(search, openAiCompatible(base, 'test', 1000), 5, 0, 24000);
  assert.match((await chat.answer(request)).answer, /Тест \[DEMO-001\]/);
  const failing = new ChatService(search, openAiCompatible(base, 'broken', 1000), 5, 0, 24000);
  const result = await failing.answer(request);
  assert.match(result.answer, /Пояснение недоступно/);
  assert.equal(result.sources[0].id, 'DEMO-001');
});
