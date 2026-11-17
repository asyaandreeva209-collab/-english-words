// Формат ответа ИИ: строгая схема для structured outputs и мягкий разбор с нормализацией.
import { z } from 'zod';
import { normalizeFront } from '../parseList';

export type AiItemKind = 'word' | 'phrase';

/** Нормализованный элемент ответа ИИ. */
export interface AiItem {
  front: string;
  back: string;
  example?: string;
  comment?: string;
  kind?: AiItemKind;
  uncertain?: boolean;
}

/**
 * Схема для output_config.format (JSON Schema строится из неё).
 * Все поля обязательны, необязательные — nullable: так structured outputs надёжнее.
 */
export const AiOutputSchema = z.object({
  items: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      example: z.string().nullable(),
      comment: z.string().nullable(),
      kind: z.enum(['word', 'phrase']).nullable(),
      uncertain: z.boolean().nullable(),
    }),
  ),
});

// Мягкая схема для проверки ответа: лишние поля отбрасываются, необязательные можно не присылать,
// незнакомый kind не роняет весь ответ.
const optText = z.string().nullish();
const LenientItem = z.object({
  front: z.string().nullish(),
  back: z.string().nullish(),
  example: optText,
  comment: optText,
  kind: z.enum(['word', 'phrase']).nullish().catch(undefined),
  uncertain: z.boolean().nullish().catch(undefined),
});
const LenientResponse = z.union([z.object({ items: z.array(LenientItem) }), z.array(LenientItem)]);

/** Ответ модели не удалось разобрать (битый JSON или не та структура). */
export class AiResponseFormatError extends Error {
  constructor(message = 'Ответ ИИ не похож на список слов') {
    super(message);
    this.name = 'AiResponseFormatError';
  }
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Снимает обёртку ```json ... ``` (на случай, если модель её добавила). */
export function stripCodeFence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return m ? (m[1] ?? '') : text.trim();
}

/**
 * Разбор текста ответа: JSON → проверка → нормализация (trim, схлопнуть пробелы,
 * null → поле отсутствует, пустые строки выкинуть, повторы по front — только первый).
 */
export function parseAiResponse(text: string): AiItem[] {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(text));
  } catch {
    throw new AiResponseFormatError('ИИ вернул повреждённый ответ');
  }
  const res = LenientResponse.safeParse(json);
  if (!res.success) throw new AiResponseFormatError();
  const raw = Array.isArray(res.data) ? res.data : res.data.items;

  const seen = new Set<string>();
  const out: AiItem[] = [];
  for (const r of raw) {
    const front = clean(r.front);
    const back = clean(r.back);
    if (!front && !back) continue;
    const key = normalizeFront(front);
    if (front && seen.has(key)) continue;
    if (front) seen.add(key);
    const item: AiItem = { front, back };
    const example = clean(r.example);
    const comment = clean(r.comment);
    if (example) item.example = example;
    if (comment) item.comment = comment;
    if (r.kind) item.kind = r.kind;
    if (r.uncertain) item.uncertain = true;
    out.push(item);
  }
  return out;
}

/** Ключ сравнения с уже известными словами: normalizeFront и без ведущего «to » у глаголов. */
export function knownKey(front: string): string {
  return normalizeFront(front).replace(/^to /, '');
}

/**
 * Уже известные слова для режима «скрин/текст»: только словарные колоды (грамматика — не слова),
 * от старых к новым — в промпт уходят последние.
 */
export function collectKnownFronts(
  decks: { id: string; kind: string }[],
  notes: { deckId: string; front: string; createdAt: number }[],
): string[] {
  const vocab = new Set(decks.filter((d) => d.kind === 'vocab').map((d) => d.id));
  return notes
    .filter((n) => vocab.has(n.deckId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((n) => n.front);
}

/** Убирает слова, которые уже есть в колодах пользователя. */
export function filterKnown<T extends { front: string }>(items: T[], knownFronts: Iterable<string>): T[] {
  const known = new Set<string>();
  for (const f of knownFronts) known.add(knownKey(f));
  return items.filter((it) => !known.has(knownKey(it.front)));
}
