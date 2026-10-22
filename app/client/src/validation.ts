import { S } from './strings';

export const MAX_LENGTH = 1000;
export const MIN_WORDS = 3;

// Совпадает с проверкой API: слово — последовательность букв или цифр.
export function countWords(text: string): number {
  return (text.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

export function validateMessage(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LENGTH) return S.tooLong;
  if (countWords(trimmed) < MIN_WORDS) return S.tooShort;
  return null;
}
