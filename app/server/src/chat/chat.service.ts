import { Scope } from '../corpus/corpus.js';
import { Complete, FilterRefusal, Message } from '../llm/llm.service.js';
import { cite, disclaimer, refusal, systemPrompt } from '../llm/prompts.js';
import { compareIds, tokens } from '../search/bm25.js';
import { Hit, SearchService } from '../search/search.service.js';
import { functionWords } from './function-words.js';

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

type Context = ReturnType<typeof buildContext>;

// Статья считается найденной, только если с вопросом совпало хотя бы одно содержательное
// слово: совпадения по служебным словам («как», «с», «и») есть почти в любой статье.
function contentMatches(message: string, hits: Hit[]): Hit[] {
  const words = new Set(tokens(message).filter((word) => !functionWords.has(word)));
  return hits.filter((hit) => [hit.article.title, ...hit.fragments.map(({ text }) => text)]
    .some((text) => tokens(text).some((word) => words.has(word))));
}

// Ключ статьи по тексту метки в квадратных скобках. Понимает варианты записи модели:
// «Конституция РФ, ст. 23», «ст. 23 УК РФ», «УК РФ ст.37 ч.1», «Статья 23 Конституции», «DEMO-001».
function labelKey(text: string): string | undefined {
  const value = text.toLowerCase().replaceAll('ё', 'е');
  const demo = value.match(/demo-\d+/u);
  if (demo) return demo[0].toUpperCase();
  const code = /конституц/u.test(value) ? 'constitution'
    : /(?:^|[^\p{L}])ук(?:[^\p{L}]|$)|уголовн/u.test(value) ? 'criminal_code' : undefined;
  const article = value.match(/(?:^|[^\p{L}])ст(?:атья|атьи|атье|атьей|атью|\.)?\s*(\d+(?:\.\d+)*)/u)?.[1];
  return code && article ? `${code}:${article}` : undefined;
}

const normalized = (text: string) => text.toLowerCase().replaceAll('ё', 'е').replace(/[\s.!]+/gu, ' ').trim();

interface CheckedAnswer {
  answer: string;
  // Почему пояснение заменено фразой о недостатке сведений: только счётчики, без текста ответа.
  rejection?: string;
  modelRefusal?: boolean;
}

// Метки статей из контекста приводятся к виду «[УК РФ ст. N]», по которому интерфейс
// открывает статью. Абзац без метки или метка статьи не из контекста — пояснение
// заменяется фразой о недостатке сведений (spec/tech/architecture.md, раздел 2, п. 5).
function validatedAnswer(raw: string, labels: Map<string, string>): CheckedAnswer {
  const answer = raw.trim();
  if (normalized(answer).startsWith(normalized(refusal))) return { answer: refusal, modelRefusal: true };
  let foreign = 0;
  const paragraphs = answer.split(/\n\s*\n/u)
    // Контракт API — простой текст: выделение Markdown и заголовки убираются.
    .map((paragraph) => paragraph.replace(/\*\*(.+?)\*\*/gsu, '$1').replace(/__(.+?)__/gsu, '$1').replace(/^#{1,6}\s+/gmu, ''))
    .filter((paragraph) => paragraph.trim() !== disclaimer)
    .map((paragraph) => paragraph.replace(/\[([^\]\n]+)\]/gu, (ref, inner: string) => {
      const label = labels.get(labelKey(inner) ?? '');
      if (!label) foreign += 1;
      return label ?? ref;
    }));
  const unlabeled = paragraphs.flatMap((paragraph, index) => (/\[[^\]\n]+\]/u.test(paragraph) ? [] : [index + 1]));
  if (paragraphs.length > 0 && unlabeled.length === 0 && foreign === 0) return { answer: paragraphs.join('\n\n') };
  return {
    answer: refusal,
    rejection: `абзацев: ${paragraphs.length}; без метки: ${unlabeled.length ? unlabeled.map((n) => `№${n}`).join(', ') : 'нет'}; меток статей не из контекста: ${foreign}`,
  };
}

export interface ChatTrace {
  contextArticleIds: string[];
  degradation: boolean;
  // Причина деградации для журнала сервера; текста вопроса не содержит.
  error?: string;
  // Пояснение модели отклонено проверкой меток (счётчики) или модель сама сообщила о недостатке сведений.
  rejection?: string;
  modelRefusal?: boolean;
  // Статьи, без которых запрос прошёл встроенный фильтр модели.
  filteredOut?: string[];
}

// Код ошибки сети или TLS лежит в самой ошибке (node:https) или в её причине (fetch).
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const own = (error as { code?: unknown }).code;
  const code = typeof own === 'string' ? own : (error.cause as { code?: unknown } | undefined)?.code;
  return `${error.name}: ${error.message}${typeof code === 'string' && !error.message.includes(code) ? ` (${code})` : ''}`;
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
    // Все совпавшие статьи по убыванию балла, из них — с содержательным совпадением, первые MAX_CONTEXT_DOCS.
    const hits = contentMatches(message, this.search.retrieve(message, scope, Number.MAX_SAFE_INTEGER, this.minScore))
      .slice(0, this.limit);
    if (!hits.length) {
      this.trace?.({ contextArticleIds: [], degradation: false });
      return this.response(notFound, []);
    }

    // Бюджет размера входа задаётся отдельно для используемой модели.
    const system: Message = { role: 'system', content: systemPrompt };
    const required = Buffer.byteLength(JSON.stringify([system, { role: 'user', content: JSON.stringify({ question: message, context: [] }) }]));
    const budget = this.budget - required - 32;
    let context = buildContext(hits, budget);
    if (!context.blocks.length) {
      this.trace?.({ contextArticleIds: [], degradation: true, error: 'ни один фрагмент не поместился в LLM_CONTEXT_BYTES' });
      return this.response(unavailable, hits);
    }

    const ask = (selected: Context) => {
      let remaining = budget - Buffer.byteLength(JSON.stringify(JSON.stringify(selected.blocks)));
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
        { role: 'user', content: JSON.stringify({ question: message, context: selected.blocks }) },
      ];
      return this.complete ? this.complete(messages) : Promise.resolve(this.preview(message, selected.blocks));
    };

    const filteredOut: string[] = [];
    try {
      let raw: string;
      try {
        raw = await ask(context);
      } catch (error) {
        if (!(error instanceof FilterRefusal)) throw error;
        // Встроенный фильтр модели отклоняет запрос из-за текста одной из статей. Запрос
        // повторяется без одной статьи, по очереди с конца списка; отказ фильтра приходит быстро.
        let recovered: { context: Context; raw: string } | undefined;
        for (const excluded of [...context.hits].reverse()) {
          if (context.hits.length < 2) break;
          const reduced = buildContext(context.hits.filter((hit) => hit !== excluded), budget);
          try {
            recovered = { context: reduced, raw: await ask(reduced) };
            filteredOut.push(excluded.article.id);
            break;
          } catch (retryError) {
            if (!(retryError instanceof FilterRefusal)) throw retryError;
          }
        }
        if (!recovered) throw error;
        ({ context, raw } = recovered);
      }
      const labels = new Map(context.hits.map((hit) => [hit.article.id, cite(hit.article)] as const));
      const checked = validatedAnswer(raw, labels);
      this.trace?.({
        contextArticleIds: context.hits.map(({ article }) => article.id), degradation: false,
        rejection: checked.rejection, modelRefusal: checked.modelRefusal, filteredOut,
      });
      return this.response(checked.answer, context.hits);
    } catch (error) {
      this.trace?.({
        contextArticleIds: context.hits.map(({ article }) => article.id), degradation: true, error: describeError(error),
      });
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
