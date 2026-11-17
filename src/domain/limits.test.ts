import { describe, expect, it } from 'vitest';
import { cardsPerWord, legacyCardsLimitToWords, MAX_LIMIT, parseLimit } from './limits';

describe('limits', () => {
  it('cardsPerWord', () => {
    expect(cardsPerWord(true)).toBe(2);
    expect(cardsPerWord(false)).toBe(1);
  });

  it('legacyCardsLimitToWords: деление, округление вверх, минимум 1, 0 остаётся 0', () => {
    expect(legacyCardsLimitToWords(20, true)).toBe(10);
    expect(legacyCardsLimitToWords(21, true)).toBe(11);
    expect(legacyCardsLimitToWords(21, false)).toBe(21);
    expect(legacyCardsLimitToWords(1, true)).toBe(1);
    expect(legacyCardsLimitToWords(0, true)).toBe(0);
    expect(legacyCardsLimitToWords(0, false)).toBe(0);
    expect(legacyCardsLimitToWords(-5, false)).toBe(1);
    expect(legacyCardsLimitToWords(Number.NaN, true)).toBe(1);
  });

  it('parseLimit: целые от 0 до 200', () => {
    expect(MAX_LIMIT).toBe(200);
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit(' 7 ')).toBe(7);
    expect(parseLimit('0')).toBe(0);
    expect(parseLimit('200')).toBe(200);
    expect(parseLimit('201')).toBeNull();
    expect(parseLimit('99999')).toBeNull();
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('-3')).toBeNull();
    expect(parseLimit('2.5')).toBeNull();
    expect(parseLimit('abc')).toBeNull();
  });
});
