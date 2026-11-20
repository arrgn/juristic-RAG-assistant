import { Scope } from '../corpus/corpus.js';
import { Complete, Message } from '../llm/llm.service.js';
import { cite, disclaimer, refusal, systemPrompt } from '../llm/prompts.js';
import { compareIds, tokens } from '../search/bm25.js';
import { Hit, SearchService } from '../search/search.service.js';

export const notFound = 'Подходящих статей в Конституции РФ и Уголовном кодексе РФ не найдено. Переформулируйте вопрос: опишите ситуацию и о каком праве или правонарушении идёт речь.';
const unavailable = 'Пояснение недоступно: языковая модель не ответила. Список подходящих статей ниже.';
const demoIntro = 'Демонстрационные данные: ответ составлен по вымышленным записям.';

export interface ChatRequest {
  message: string;
  scope: Scope;
  history: Array<Message & { role: 'user' | 'assistant' }>;
}

function contextBlock(hit: Hit, text: string) {
  return { label: cite(hit.article), title: hit.article.title, edition_date: hit.article.edition_date, text };
}

function buildContext(hits: Hit[], budget: number) {
  const used = new Set<Hit>();
  const blocks: ReturnType<typeof contextBlock>[] = [];
  function add(hit: Hit, text: string) {
    const block = contextBlock(hit, text);
    const size = Buffer.byteLength(JSON.stringify(JSON.stringify(block))) + 1;
    if (size > budget) return;
    budget -= size;
    used.add(hit);
    blocks.push(block);
  }

  for (const hit of hits) add(hit, hit.fragments[0].text);
  const extras = [...used].flatMap((hit) => hit.fragments.slice(1).map((fragment) => ({ hit, fragment })));
  extras.sort((a, b) => b.fragment.score - a.fragment.score
    || compareIds(a.hit.article.id, b.hit.article.id)
    || a.fragment.position - b.fragment.position);
  for (const { hit, fragment } of extras) add(hit, fragment.text);
  return { blocks, hits: hits.filter((hit) => used.has(hit)) };
}

function validatedAnswer(raw: string, labels: Set<string>): string {
  const answer = raw.trim();
  if (answer === refusal) return refusal;
  const paragraphs = answer.split(/\n\s*\n/u).filter((paragraph) => paragraph.trim() !== disclaimer);
  const valid = paragraphs.length > 0 && paragraphs.every((paragraph) => {
    const refs = paragraph.match(/\[[^\]\n]+\]/gu) ?? [];
    return refs.length > 0 && refs.every((ref) => labels.has(ref));
  });
  return valid ? paragraphs.join('\n\n') : refusal;
}

export interface ChatTrace {
  contextArticleIds: string[];
  degradation: boolean;
}

export class ChatService {
  constructor(
    private readonly search: SearchService,
    private readonly complete: Complete | undefined,
    private readonly limit: number,
    private readonly minScore: number,
    private readonly budget: number,
    private readonly trace?: (event: ChatTrace) => void,
  ) {}

  async answer(request: ChatRequest) {
    const { message, scope, history } = request;
    const hits = this.search.retrieve(message, scope, this.limit, this.minScore);
    if (!hits.length) {
      this.trace?.({ contextArticleIds: [], degradation: false });
      return this.response(notFound, []);
    }

    // Бюджет размера входа задаётся отдельно для используемой модели.
    const system: Message = { role: 'system', content: systemPrompt };
    const required = Buffer.byteLength(JSON.stringify([system, { role: 'user', content: JSON.stringify({ question: message, context: [] }) }]));
    const context = buildContext(hits, this.budget - required - 32);
    if (!context.blocks.length) {
      this.trace?.({ contextArticleIds: [], degradation: true });
      return this.response(unavailable, hits);
    }

    let remaining = this.budget - required - Buffer.byteLength(JSON.stringify(JSON.stringify(context.blocks))) - 32;
    const retained: Message[] = [];
    for (const entry of [...history].reverse()) {
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (size > remaining) break;
      retained.unshift(entry);
      remaining -= size;
    }

    const messages: Message[] = [
      system,
      ...retained,
      { role: 'user', content: JSON.stringify({ question: message, context: context.blocks }) },
    ];
    const contextArticleIds = context.hits.map(({ article }) => article.id);
    try {
      const raw = this.complete
        ? await this.complete(messages)
        : this.preview(message, context.blocks);
      const answer = validatedAnswer(raw, new Set(context.blocks.map(({ label }) => label)));
      this.trace?.({ contextArticleIds, degradation: false });
      return this.response(answer, context.hits);
    } catch {
      this.trace?.({ contextArticleIds, degradation: true });
      return this.response(unavailable, hits);
    }
  }

  private preview(question: string, blocks: ReturnType<typeof contextBlock>[]): string {
    const query = new Set(tokens(question).filter((word) => word.length >= 4));
    const block = blocks.find(({ title, text }) =>
      tokens(`${title} ${text}`).some((word) => query.has(word)),
    );
    return block ? `Фрагмент источника ${block.label}\n${block.text.replace(/\n\s*\n/gu, '\n')}` : refusal;
  }

  private response(answer: string, hits: Hit[]) {
    const demo = hits.some(({ article }) => article.id.startsWith('DEMO-'));
    return {
      answer: [demo ? demoIntro : '', answer, disclaimer].filter(Boolean).join('\n\n'),
      sources: hits.map(({ article, score }) => ({
        id: article.id,
        code: article.code,
        article: article.article,
        title: article.title,
        text: article.text,
        source_url: article.source_url,
        score,
      })),
    };
  }
}
