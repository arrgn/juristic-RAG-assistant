export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type Complete = (messages: Message[]) => Promise<string>;

// Сообщение провайдера для журнала сервера: одной строкой, не длиннее 300 символов.
function detail(text: string): string {
  const line = text.replace(/\s+/gu, ' ').trim().slice(0, 300);
  return line ? `: ${line}` : '';
}

// Ответ остановлен встроенным фильтром модели (finish_reason: content_filter). ChatService
// повторяет такой запрос без одной из статей контекста (spec/tech/architecture.md, раздел 2, п. 4).
export class FilterRefusal extends Error {
  constructor(reason: string) {
    super(`модель отклонила запрос фильтром (finish_reason: ${reason})`);
    this.name = 'FilterRefusal';
  }
}

// Текст ответа в формате chat/completions.
function answerText(result: unknown): string {
  const choice = (result as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> } | null)
    ?.choices?.[0];
  if (choice?.finish_reason === 'content_filter') throw new FilterRefusal('content_filter');
  const answer = choice?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Пустой ответ LLM');
  return answer;
}

// Адрес POST <LLM_BASE_URL>/chat/completions: только http(s), без завершающего слеша в базе.
export function chatCompletionsUrl(baseUrl: string): URL {
  const address = baseUrl.trim().replace(/\/+$/u, '') + '/chat/completions';
  const url = URL.canParse(address) ? new URL(address) : undefined;
  if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('Проверьте LLM_BASE_URL');
  return url;
}

// Любой сервис с OpenAI-совместимым API: Cloud.ru Foundation Models, локальный Ollama и т. п.
// Ключ передаётся как Authorization: Bearer <LLM_API_KEY>; без ключа заголовок не отправляется.
export function openAiCompatible(baseUrl: string, model: string, timeout: number, apiKey?: string): Complete {
  const url = chatCompletionsUrl(baseUrl);
  if (!model.trim()) throw new Error('Задайте LLM_MODEL');
  return async (messages) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: model.trim(), messages }),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}${detail(await response.text().catch(() => ''))}`);
    }
    return answerText(await response.json());
  };
}
