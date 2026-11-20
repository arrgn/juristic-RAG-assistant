export function tokens(text: string): string[] {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export class Bm25<T> {
  private readonly postings = new Map<string, Map<T, number>>();
  private readonly lengths = new Map<T, number>();
  private readonly averageLength: number;

  constructor(documents: Iterable<readonly [T, string]>) {
    let totalLength = 0;
    for (const [id, text] of documents) {
      const words = tokens(text);
      if (words.length === 0) continue;

      this.lengths.set(id, words.length);
      totalLength += words.length;
      for (const word of words) {
        let posting = this.postings.get(word);
        if (!posting) {
          posting = new Map();
          this.postings.set(word, posting);
        }
        posting.set(id, (posting.get(id) ?? 0) + 1);
      }
    }
    this.averageLength = this.lengths.size ? totalLength / this.lengths.size : 0;
  }

  score(query: string): Map<T, number> {
    const scores = new Map<T, number>();
    const k1 = 1.2;
    const b = 0.75;
    for (const word of new Set(tokens(query))) {
      const posting = this.postings.get(word);
      if (!posting) continue;

      const df = posting.size;
      const idf = Math.log1p((this.lengths.size - df + 0.5) / (df + 0.5));
      for (const [id, frequency] of posting) {
        const length = this.lengths.get(id)!;
        const norm = k1 * (1 - b + b * length / this.averageLength);
        const contribution = idf * frequency * (k1 + 1) / (frequency + norm);
        scores.set(id, (scores.get(id) ?? 0) + contribution);
      }
    }
    return scores;
  }
}
