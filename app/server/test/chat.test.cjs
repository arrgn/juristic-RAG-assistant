// Пайплайн чата на срезе из 30 статей: отбор статей по содержательным словам
// и проверка меток в ответе модели (spec/tech/architecture.md, раздел 2).
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadCorpus } = require('../dist/corpus/corpus.js');
const { SearchService } = require('../dist/search/search.service.js');
const { ChatService, notFound } = require('../dist/chat/chat.service.js');
const { refusal } = require('../dist/llm/prompts.js');
const { FilterRefusal } = require('../dist/llm/llm.service.js');

const search = new SearchService(loadCorpus(join(__dirname, '../data/benchmark/articles.json')));
const privacy = 'Могут ли у меня без разрешения суда читать личную переписку и прослушивать телефонные разговоры?';

// Модель-заглушка: запоминает метки переданного контекста и возвращает заданный текст.
function chatWith(reply) {
  const state = { calls: 0, labels: [], events: [] };
  const model = async (messages) => {
    state.calls += 1;
    state.labels = JSON.parse(messages.at(-1).content).context.map(({ label }) => label);
    return reply;
  };
  const chat = new ChatService(search, model, 5, 0, 24000, (event) => state.events.push(event));
  return { chat, state };
}

test('Вопрос не по теме: совпадения только по служебным словам — «Ничего не найдено» без вызова модели', async () => {
  const { chat, state } = chatWith('Не должно вызываться');
  for (const message of ['Как приготовить борщ с фасолью и копчёностями?', 'Когда открывается ближайшая городская библиотека?']) {
    const result = await chat.answer({ message, scope: 'all', history: [] });
    assert.deepEqual(result.sources, []);
    assert.ok(result.answer.startsWith(notFound));
  }
  assert.equal(state.calls, 0);
});

test('Статьи, совпавшие только служебными словами, не попадают в контекст', async () => {
  const { chat, state } = chatWith('Нет, только по судебному решению [Конституция РФ ст. 23].');
  const result = await chat.answer({ message: privacy, scope: 'all', history: [] });
  assert.ok(state.labels.includes('[Конституция РФ ст. 23]'));
  assert.ok(!state.labels.includes('[УК РФ ст. 61]'));
  assert.ok(!result.sources.some(({ id }) => id === 'criminal_code:61'));
  assert.match(result.answer, /^Нет, только по судебному решению \[Конституция РФ ст\. 23\]\./u);
});

test('Варианты записи метки приводятся к виду, по которому интерфейс открывает статью', async () => {
  for (const written of ['[Конституция РФ, ст. 23]', '[ст. 23 Конституции РФ]', '[Статья 23 Конституции РФ, ч. 2]']) {
    const { chat, state } = chatWith(`Только по судебному решению ${written}.`);
    const result = await chat.answer({ message: privacy, scope: 'all', history: [] });
    assert.match(result.answer, /^Только по судебному решению \[Конституция РФ ст\. 23\]\./u, written);
    assert.equal(state.events.at(-1).rejection, undefined);
  }
});

test('Абзац без метки или чужая метка: отказ и причина в журнале без текста ответа', async () => {
  const cases = [
    ['Первый абзац [Конституция РФ ст. 23].\n\nВывод без ссылки.', 'абзацев: 2; без метки: №2; меток статей не из контекста: 0'],
    ['Ответ со ссылкой на чужую статью [УК РФ ст. 105].', 'абзацев: 1; без метки: нет; меток статей не из контекста: 1'],
  ];
  for (const [reply, reason] of cases) {
    const { chat, state } = chatWith(reply);
    const result = await chat.answer({ message: privacy, scope: 'all', history: [] });
    assert.ok(result.answer.startsWith(refusal));
    assert.equal(state.events.at(-1).rejection, reason);
  }
});

test('Выделение Markdown убирается: контракт API — простой текст', async () => {
  const { chat } = chatWith('**Только** по __судебному__ решению [Конституция РФ ст. 23].');
  const result = await chat.answer({ message: privacy, scope: 'all', history: [] });
  assert.match(result.answer, /^Только по судебному решению \[Конституция РФ ст\. 23\]\./u);
});

const salary = 'Что гарантировано в отношении оплаты труда, социального обеспечения при болезни и медицинской помощи в государственных учреждениях?';

test('Отказ фильтра модели: запрос повторяется без статьи, из-за которой он отклонён', async () => {
  const attempts = [];
  const model = async (messages) => {
    const labels = JSON.parse(messages.at(-1).content).context.map(({ label }) => label);
    attempts.push(labels);
    if (labels.includes('[УК РФ ст. 63]')) throw new FilterRefusal('content_filter');
    return 'Гарантирована государственная пенсия и пособие [Конституция РФ ст. 39].';
  };
  const events = [];
  const chat = new ChatService(search, model, 5, 0, 24000, (event) => events.push(event));
  const result = await chat.answer({ message: salary, scope: 'all', history: [] });
  assert.ok(attempts[0].includes('[УК РФ ст. 63]'));
  assert.match(result.answer, /\[Конституция РФ ст\. 39\]/u);
  assert.ok(!result.sources.some(({ id }) => id === 'criminal_code:63'));
  assert.deepEqual(events.at(-1).filteredOut, ['criminal_code:63']);
  assert.equal(events.at(-1).degradation, false);
});

test('Если фильтр отклоняет любой вариант запроса — сценарий А4 с причиной в журнале', async () => {
  const events = [];
  const chat = new ChatService(search, async () => { throw new FilterRefusal('content_filter'); }, 5, 0, 24000, (event) => events.push(event));
  const result = await chat.answer({ message: salary, scope: 'all', history: [] });
  assert.match(result.answer, /Пояснение недоступно/u);
  assert.equal(events.at(-1).degradation, true);
  assert.match(events.at(-1).error, /finish_reason: content_filter/u);
});

test('Отказ самой модели распознаётся и отмечается отдельно', async () => {
  const { chat, state } = chatWith(`${refusal.slice(0, -1)}\n\nПодходящих норм в контексте нет.`);
  const result = await chat.answer({ message: privacy, scope: 'all', history: [] });
  assert.ok(result.answer.startsWith(refusal));
  assert.equal(state.events.at(-1).modelRefusal, true);
  assert.equal(state.events.at(-1).rejection, undefined);
});
