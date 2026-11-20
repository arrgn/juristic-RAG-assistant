export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type Complete = (messages: Message[]) => Promise<string>;

export function openAiCompatible(baseUrl: string, model: string, timeout: number, apiKey?: string): Complete {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
  if (!['http:', 'https:'].includes(url.protocol) || !model.trim()) {
    throw new Error('Проверьте LLM_BASE_URL и LLM_MODEL');
  }
  return async (messages) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);

    const result = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const answer = result?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('Пустой ответ LLM');
    return answer;
  };
}
