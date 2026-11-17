// Загрузка данных из БД и построение очереди (сама логика — domain/queue.ts).
import { db } from '../../db/schema';
import { getSettings } from '../../db/repo';
import { buildQueue, dayStart, type QueueResult } from '../../domain/queue';
import type { Settings } from '../../domain/types';

/** Сколько новых слов добавляет «Учить ещё» (?more=5). */
export const MORE_NEW = 5;

export interface LoadedQueue extends QueueResult {
  settings: Settings;
}

/** extraNew — «Учить ещё»: новые слова сверх дневного лимита. */
export async function loadQueue(now: number, deckId?: string, extraNew?: number): Promise<LoadedQueue> {
  const settings = await getSettings();
  const start = dayStart(now, settings.dayStartsAtHour);
  // Все карточки нужны всегда: по ним считается, какие слова уже знакомы и сколько введено сегодня
  const [decks, allCards, noteIds, logs] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.notes.toCollection().primaryKeys(),
    db.reviewLogs.where('reviewedAt').aboveOrEqual(start).toArray(),
  ]);
  // Карточки-сироты (заметка удалена) не показываем
  const existingNotes = new Set(noteIds);
  const cards = allCards.filter((c) => existingNotes.has(c.noteId));
  const q = buildQueue({
    cards,
    decks,
    logs,
    newPerDay: settings.newPerDay,
    dayStartsAtHour: settings.dayStartsAtHour,
    now,
    deckId,
    extraNew,
  });
  return { ...q, settings };
}
