import { EXAMPLES, S } from '../strings';
import type { ChatRequest, ChatResponse, Source } from '../types';
import { DEMO_INTRO, DEMO_SOURCES, DEMO_SUMMARY } from '../mock/demo';
import { validateMessage } from '../validation';

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

// Режим задаётся адресом: ?mock=offline имитирует недоступный сервер (сценарий А5),
// ?mock=off отправляет запросы на настоящий /api/chat.
function mode(): string {
  return new URLSearchParams(window.location.search).get('mock') ?? 'on';
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  const m = mode();
  if (m === 'off') return callServer(req);
  return mockChat(req, m === 'offline');
}

async function callServer(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new HttpError(res.status);
  const data: unknown = await res.json();
  if (!isChatResponse(data)) throw new Error('bad response');
  return data;
}

function isChatResponse(d: unknown): d is ChatResponse {
  const r = d as ChatResponse | null;
  return !!r && typeof r.answer === 'string' && Array.isArray(r.sources);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Мок не ранжирует: ответ зависит только от выбранного примера (scenarios.md, раздел 7).
async function mockChat(req: ChatRequest, offline: boolean): Promise<ChatResponse> {
  await wait(800);
  if (offline) throw new HttpError(503);
  if (validateMessage(req.message)) throw new HttpError(422);

  let pool: Source[] = DEMO_SOURCES;
  const text = req.message.trim();
  if (text === EXAMPLES[0].text) pool = [DEMO_SOURCES[0]];
  else if (text === EXAMPLES[1].text) pool = DEMO_SOURCES.slice(1);
  else if (text === EXAMPLES[2].text) pool = [];

  const sources = pool
    .filter((s) => req.scope === 'all' || s.code === req.scope)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (sources.length === 0) return { answer: S.notFound, sources: [] };

  const body = sources.map((s) => `[${s.id}] ${DEMO_SUMMARY[s.id]}`);
  return { answer: [DEMO_INTRO, ...body, S.footer].join('\n\n'), sources };
}
