import { readFileSync } from 'node:fs';

export const codes = ['constitution', 'criminal_code'] as const;
export type Code = typeof codes[number];
export type Scope = 'all' | Code;

export interface Article {
  id: string;
  code: Code;
  article: string;
  title: string;
  text: string;
  source_url: string;
  edition_date?: string;
}

function isArticle(value: unknown, demo: boolean): value is Article {
  if (typeof value !== 'object' || value === null) return false;

  const item = value as Record<string, unknown>;
  if (!codes.some((code) => code === item.code) || typeof item.title !== 'string'
    || typeof item.text !== 'string' || !item.text.trim()) return false;

  if (demo) {
    return typeof item.id === 'string' && /^DEMO-\d+$/.test(item.id)
      && item.article === 'DEMO' && item.source_url === 'демонстрационные данные';
  }

  return typeof item.article === 'string' && /^\d+(?:\.\d+)*$/.test(item.article)
    && item.id === `${item.code}:${item.article}`
    && typeof item.source_url === 'string' && URL.canParse(item.source_url)
    && ['https:', 'http:'].includes(new URL(item.source_url).protocol)
    && typeof item.edition_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.edition_date)
    && Number.isFinite(Date.parse(item.edition_date))
    && new Date(item.edition_date).toISOString().startsWith(item.edition_date);
}

export function loadCorpus(path: string, demo = false): Article[] {
  const articles: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(articles) || articles.length === 0 || !articles.every((article) => isArticle(article, demo))) {
    throw new Error(`Некорректный корпус статей: ${path}`);
  }
  if (new Set(articles.map(({ id }) => id)).size !== articles.length) {
    throw new Error(`Повторяющиеся ID в корпусе: ${path}`);
  }
  return articles;
}
