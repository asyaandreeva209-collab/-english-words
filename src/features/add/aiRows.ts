// Ответ ИИ → строки PreviewTable и обратно в заметки. Чистые функции (тестируются без React).
import type { NoteInput } from '../../db/repo';
import type { AiItem } from '../../domain/ai/schema';
import { findDuplicates } from '../../domain/parseList';
import { rowIsValid, type PreviewRow } from './PreviewTable';

export type AiMode = 'dictionary' | 'extract';

let rowKey = 0;

/**
 * Строки превью: всё с галочками, кроме дубликатов колоды и строк без перевода.
 * В режиме «скрин/текст» поле примера показываем всегда (там пример — из источника).
 */
export function aiItemsToRows(items: AiItem[], mode: AiMode, deckFronts: string[]): PreviewRow[] {
  const dups = findDuplicates(items, deckFronts);
  return items.map((it, i) => {
    const row: PreviewRow = {
      key: `ai-${++rowKey}`,
      front: it.front,
      back: it.back,
      comment: it.comment ?? '',
      include: false,
    };
    if (mode === 'extract' || it.example) row.example = it.example ?? '';
    if (it.uncertain) row.uncertain = true;
    row.include = rowIsValid(row) && !dups.has(i);
    return row;
  });
}

/** Смена колоды: снять галочки со строк, которые стали дубликатами новой колоды (остальные не трогаем). */
export function uncheckDuplicates(rows: PreviewRow[], deckFronts: string[]): PreviewRow[] {
  const dups = findDuplicates(rows, deckFronts);
  if (![...dups].some((i) => rows[i]?.include)) return rows;
  return rows.map((r, i) => (dups.has(i) && r.include ? { ...r, include: false } : r));
}

/** Отмеченные валидные строки → данные для addNotes (пример идёт в Note.example). */
export function rowsToNotes(rows: PreviewRow[]): NoteInput[] {
  return rows
    .filter((r) => r.include && rowIsValid(r))
    .map((r) => {
      const n: NoteInput = { front: r.front, back: r.back, comment: r.comment };
      if (r.example !== undefined) n.example = r.example;
      return n;
    });
}
