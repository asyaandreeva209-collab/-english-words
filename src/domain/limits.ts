// Лимит новых хранится в СЛОВАХ (заметках). До версии БД 2 он хранился в карточках.

export function cardsPerWord(createReverse: boolean): number {
  return createReverse ? 2 : 1;
}

/** Верхняя граница лимита новых слов в день. 0 — только повторения, без новых слов. */
export const MAX_LIMIT = 200;

/**
 * Перевод старого лимита (в карточках) в слова для миграции БД:
 * делим на число карточек на слово, округляем вверх, минимум 1; 0 остаётся 0 (без новых).
 */
export function legacyCardsLimitToWords(cards: number, createReverse: boolean): number {
  if (!Number.isFinite(cards)) return 1;
  if (cards === 0) return 0;
  return Math.max(1, Math.ceil(cards / cardsPerWord(createReverse)));
}

/** Разбор лимита из поля ввода: целое от 0 до max (по умолчанию MAX_LIMIT), иначе null. */
export function parseLimit(text: string, max = MAX_LIMIT): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}
