const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { createApp } = require('../dist/main.js');
const { loadCorpus } = require('../dist/corpus/corpus.js');
const { SearchService } = require('../dist/search/search.service.js');

const directory = join(__dirname, '../data/benchmark');
const names = ['articles.json', 'documents.json', 'questions.json', 'sources.json'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const searchDepth = 3;

async function run() {
  const buffers = await Promise.all(names.map((name) => readFile(join(directory, name))));
  const [, documents, questions, sources] = buffers.map((buffer) => JSON.parse(buffer));
  process.env.CORPUS_MODE = 'official';
  process.env.CORPUS_PATH = join(directory, names[0]);
  const articles = loadCorpus(process.env.CORPUS_PATH);
  const ids = new Map(documents.map(({ article_id, document_id }) => [article_id, document_id]));
  const baseline = questions.filter(({ kind }) => kind === 'answerable');
  const traps = questions.filter(({ kind }) => kind === 'trap');
  assert.equal(articles.length, 30);
  assert.equal(documents.length, 30);
  assert.equal(ids.size, 30);
  const documentIds = new Set(documents.map(({ document_id }) => document_id));
  assert.deepEqual([...documentIds].sort(), Array.from({ length: 30 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`));
  assert.ok(articles.every(({ id }) => ids.has(id)));
  assert.equal(questions.length, 15);
  assert.equal(new Set(questions.map(({ id }) => id)).size, 15);
  assert.equal(baseline.length, 10);
  assert.equal(traps.length, 5);
  for (const question of baseline) {
    const relevant = new Set(question.relevant_document_ids);
    assert.ok(relevant.size >= 3 && [...relevant].every((id) => documentIds.has(id)), question.id);
    assert.deepEqual(new Set(question.evidence.map(({ document_id }) => document_id)), relevant);
  }
  assert.ok(traps.every(({ relevant_document_ids }) => relevant_document_ids.length === 0));
  assert.ok(questions.every(({ scope, question, expected_answer }) => scope === 'all' && question && expected_answer));

  const provider = process.env.LLM_PROVIDER ?? 'stub';
  const minScore = Number(process.env.MIN_SCORE ?? '0');
  const search = new SearchService(articles);
  let trace;
  const app = await createApp((event) => { trace = event; });
  const rows = [];
  try {
    await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/chat`;
    for (const { id, question, scope, kind, relevant_document_ids } of questions) {
      const retrieved = search.retrieve(question, scope, searchDepth, minScore)
        .map(({ article, score }) => ({ document_id: ids.get(article.id), article_id: article.id, score }));
      const relevant = new Set(relevant_document_ids);
      const found = retrieved.filter(({ document_id }) => relevant.has(document_id)).length;
      const first = retrieved.findIndex(({ document_id }) => relevant.has(document_id));
      trace = undefined;
      let status = null;
      let answer = null;
      let returned = [];
      let error = null;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, scope, history: [] }),
        });
        status = response.status;
        if (response.ok) ({ answer, sources: returned } = await response.json());
        else error = `HTTP ${status}`;
      } catch (failure) {
        error = failure.message;
      }
      rows.push({
        id, question, kind, relevant_document_ids, retrieved,
        recall_at_3: relevant.size ? found / relevant.size : null,
        reciprocal_rank_at_3: relevant.size ? (first < 0 ? 0 : 1 / (first + 1)) : null,
        status, answer, sources: returned.map(({ id: article_id }) => ids.get(article_id)),
        context_article_ids: trace?.contextArticleIds ?? null,
        degraded: error !== null || trace?.degradation === true,
        error,
        // Причина отказа или сбоя модели для разбора ошибок; текста ответа не содержит.
        diagnostics: trace ? {
          llm_error: trace.error ?? null,
          rejection: trace.rejection ?? null,
          model_refusal: trace.modelRefusal ?? false,
          filtered_out: trace.filteredOut ?? [],
        } : null,
        review: { correct: null, reason: null },
      });
    }
  } finally {
    await app.close();
  }

  const runId = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, '-');
  assert.match(runId, /^[\w-]+$/);
  const runs = join(directory, 'runs');
  await mkdir(runs, { recursive: true });
  const output = join(runs, runId);
  await mkdir(output);
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' });
  const revision = git.status === 0 ? git.stdout.trim() : null;
  const files = [
    'corpus/corpus.js', 'search/bm25.js', 'search/search.service.js',
    'llm/prompts.js', 'llm/llm.service.js', 'chat/chat.service.js', 'main.js',
  ];
  const code = Object.fromEntries(await Promise.all(files.map(async (file) =>
    [file, sha256(await readFile(join(__dirname, '../dist', file)))])));
  await writeJson(join(output, 'config.json'), {
    revision, measured_at: new Date().toISOString(), sha256: Object.fromEntries(names.map((name, i) => [name, sha256(buffers[i])])),
    built_code_sha256: code, source_attachments: sources, k1: 1.2, b: 0.75,
    search_depth: searchDepth, min_score: minScore, max_context_docs: Number(process.env.MAX_CONTEXT_DOCS ?? '5'),
    context_bytes: Number(process.env.LLM_CONTEXT_BYTES ?? '24000'),
    tokenization: 'NFC, lower case, ё → е, Unicode letters and digits',
    segmentation: 'Up to 400 tokens or groups of numbered paragraphs',
    provider, model: process.env.LLM_MODEL ?? null, model_version: process.env.LLM_MODEL_VERSION ?? null,
    generation: provider === 'stub' ? null : 'Параметры по умолчанию у провайдера',
  });
  await writeFile(join(output, 'results.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const scored = rows.filter(({ kind }) => kind === 'answerable');
  const mean = (field) => scored.reduce((sum, row) => sum + row[field], 0) / scored.length;
  const metrics = {
    recall_at_3: mean('recall_at_3'), mrr_at_3: mean('reciprocal_rank_at_3'),
    accuracy: null, correct_rejection_rate: null,
    degraded: rows.filter(({ degraded }) => degraded).length,
    traps_with_hits: rows.filter(({ kind, retrieved }) => kind === 'trap' && retrieved.length > 0).length,
  };
  await writeJson(join(output, 'metrics.json'), metrics);
  console.log(metrics);
  console.log(output);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
