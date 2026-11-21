const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const runId = process.argv[2] ?? '';
assert.match(runId, /^[\w-]+$/, 'Укажите ID прогона');
const directory = join(__dirname, '../data/benchmark/runs', runId);
const config = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
assert.notEqual(config.provider, 'stub', 'Оценка качества требует прогона с LLM');
const rows = readFileSync(join(directory, 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
assert.equal(rows.length, 15);
assert.equal(new Set(rows.map(({ id }) => id)).size, 15);
for (const row of rows) {
  if (row.degraded) continue;
  assert.equal(typeof row.review?.correct, 'boolean', `Заполните review.correct у ${row.id}`);
  assert.ok(row.review?.reason?.trim(), `Заполните review.reason у ${row.id}`);
}
const answerable = rows.filter(({ kind }) => kind === 'answerable');
const traps = rows.filter(({ kind }) => kind === 'trap');
assert.equal(answerable.length, 10);
assert.equal(traps.length, 5);
const correct = (group) => group.filter(({ degraded, review }) => !degraded && review.correct).length / group.length;
console.log(JSON.stringify({
  accuracy: correct(answerable),
  correct_rejection_rate: correct(traps),
  degraded: rows.filter(({ degraded }) => degraded).length,
}, null, 2));
