import { Article, codes, Scope } from '../corpus/corpus.js';
import { Bm25, compareIds, tokens } from './bm25.js';

interface Fragment {
  article: Article;
  position: number;
  text: string;
}

export interface Hit {
  article: Article;
  score: number;
  fragments: Array<{ text: string; position: number; score: number }>;
}

function splitArticle(text: string): string[] {
  const target = 400;
  if (tokens(text).length <= target) return [text];

  // Части начинаются с номера. Пункты и примечания остаются в своей части.
  const parts = text.split(/\n(?=[ \t]*\d+\.\s)/u);
  const blocks: string[] = [];
  let current = parts[0];
  for (const part of parts.slice(1)) {
    if (tokens(current + '\n' + part).length > target) {
      blocks.push(current);
      current = part;
    } else {
      current += '\n' + part;
    }
  }
  blocks.push(current);
  return blocks;
}

export class SearchService {
  private readonly indexes = new Map<Scope, Bm25<Fragment>>();

  constructor(articles: Article[]) {
    const fragments = articles.flatMap((article) =>
      splitArticle(article.text).map((text, position) => ({ article, text, position })),
    );
    for (const scope of ['all', ...codes] as const) {
      const entries = fragments
        .filter(({ article }) => scope === 'all' || article.code === scope)
        .map((fragment) => [fragment, `${fragment.article.title}\n${fragment.text}`] as const);
      this.indexes.set(scope, new Bm25(entries));
    }
  }

  retrieve(query: string, scope: Scope, limit: number, minScore: number): Hit[] {
    const hits = new Map<string, Hit>();
    for (const [{ article, text, position }, score] of this.indexes.get(scope)!.score(query)) {
      let hit = hits.get(article.id);
      if (!hit) {
        hit = { article, score, fragments: [] };
        hits.set(article.id, hit);
      }
      hit.score = Math.max(hit.score, score);
      hit.fragments.push({ text, position, score });
    }

    return [...hits.values()]
      .filter(({ score }) => score >= minScore)
      .sort((a, b) => b.score - a.score || compareIds(a.article.id, b.article.id))
      .slice(0, limit)
      .map((hit) => {
        hit.fragments.sort((a, b) => b.score - a.score || a.position - b.position);
        return hit;
      });
  }
}
