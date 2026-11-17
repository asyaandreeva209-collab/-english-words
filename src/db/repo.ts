// CRUD колод/заметок/карточек, каскадное удаление, ответы и экспорт.
import { db } from './schema';
import { buildBackup, type BackupData } from '../domain/backup';
import { newCard, review, type SchedulerOptions } from '../domain/srs';
import { withDefaults } from '../domain/settings';
import type { Card, Deck, DeckKind, Direction, Note, Rating, ReviewLog, ReviewMode, Settings } from '../domain/types';

const uid = (): string => crypto.randomUUID();

// ---------- Настройки ----------

export { withDefaults } from '../domain/settings';

export async function getSettings(): Promise<Settings> {
  return withDefaults(await db.settings.get('main'));
}

export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  // Чтение и запись в одной транзакции, чтобы параллельные патчи не затирали друг друга
  await db.transaction('rw', db.settings, async () => {
    const current = withDefaults(await db.settings.get('main'));
    await db.settings.put({ ...current, ...patch, id: 'main' });
  });
}

// ---------- Колоды ----------

export async function createDeck(
  data: { name: string; kind: DeckKind; description?: string },
  now = Date.now(),
): Promise<Deck> {
  const deck: Deck = {
    id: uid(),
    name: data.name.trim(),
    kind: data.kind,
    createdAt: now,
    updatedAt: now,
  };
  if (data.description?.trim()) deck.description = data.description.trim();
  await db.decks.add(deck);
  return deck;
}

export async function updateDeck(
  id: string,
  patch: Partial<Omit<Deck, 'id' | 'createdAt' | 'kind'>>,
  now = Date.now(),
): Promise<void> {
  await db.decks.update(id, { ...patch, updatedAt: now });
}

/** Удаляет колоду вместе со словами, карточками и историей ответов. */
export async function deleteDeck(id: string): Promise<void> {
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.reviewLogs], async () => {
    await db.reviewLogs.where('deckId').equals(id).delete();
    await db.cards.where('deckId').equals(id).delete();
    await db.notes.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}

// ---------- Заметки и карточки ----------

export interface NoteInput {
  front: string;
  back: string;
  example?: string;
  comment?: string;
  transcription?: string;
}

function cleanNoteInput(input: NoteInput): NoteInput {
  const out: NoteInput = { front: input.front.trim(), back: input.back.trim() };
  for (const k of ['example', 'comment', 'transcription'] as const) {
    const v = input[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

function makeCard(note: Note, direction: Direction, now: number): Card {
  return {
    ...newCard(now),
    id: uid(),
    noteId: note.id,
    deckId: note.deckId,
    direction,
    updatedAt: now,
  };
}

/** Направления карточек для заметки: vocab — fwd (+ rev), grammar — только fwd. */
export function directionsFor(kind: DeckKind, createReverse: boolean): Direction[] {
  return kind === 'vocab' && createReverse ? ['fwd', 'rev'] : ['fwd'];
}

/** Добавляет заметки и создаёт для них карточки. */
export async function addNotes(
  deckId: string,
  inputs: NoteInput[],
  opts: { createReverse: boolean; now?: number },
): Promise<Note[]> {
  const now = opts.now ?? Date.now();
  return db.transaction('rw', [db.decks, db.notes, db.cards], async () => {
    const deck = await db.decks.get(deckId);
    if (!deck) throw new Error('Колода не найдена');
    const dirs = directionsFor(deck.kind, opts.createReverse);
    const notes: Note[] = [];
    const cards: Card[] = [];
    inputs.forEach((raw, i) => {
      // +i мс — чтобы сохранить порядок ввода при выдаче новых карточек
      const t = now + i;
      const note: Note = { ...cleanNoteInput(raw), id: uid(), deckId, createdAt: t, updatedAt: t };
      notes.push(note);
      for (const d of dirs) cards.push(makeCard(note, d, t));
    });
    await db.notes.bulkAdd(notes);
    await db.cards.bulkAdd(cards);
    await db.decks.update(deckId, { updatedAt: now });
    return notes;
  });
}

export async function addNote(
  deckId: string,
  input: NoteInput,
  opts: { createReverse: boolean; now?: number },
): Promise<Note> {
  const [note] = await addNotes(deckId, [input], opts);
  return note!;
}

export async function updateNote(id: string, input: NoteInput, now = Date.now()): Promise<void> {
  const clean = cleanNoteInput(input);
  await db.notes.update(id, {
    front: clean.front,
    back: clean.back,
    example: clean.example,
    comment: clean.comment,
    transcription: clean.transcription,
    updatedAt: now,
  });
}

/** Удаляет заметку, её карточки и их историю. */
export async function deleteNote(id: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.cards, db.reviewLogs], async () => {
    const cardIds = await db.cards.where('noteId').equals(id).primaryKeys();
    if (cardIds.length) await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    await db.cards.bulkDelete(cardIds);
    await db.notes.delete(id);
  });
}

// ---------- Ответы ----------

/** Карточку удалили (вместе со словом или колодой), пока шла сессия. */
export class CardNotFoundError extends Error {
  constructor(readonly cardId: string) {
    super('Карточка не найдена');
    this.name = 'CardNotFoundError';
  }
}

export interface ReviewResult {
  card: Card;
  log: ReviewLog;
  /** Состояние карточки до ответа — для «Отменить». */
  previous: Card;
}

export async function recordReview(
  card: Card,
  rating: Rating,
  opts: { mode: ReviewMode; now?: number; elapsedMs?: number; scheduler?: SchedulerOptions },
): Promise<ReviewResult> {
  const now = opts.now ?? Date.now();
  const updated: Card = { ...card, ...review(card, rating, now, opts.scheduler), updatedAt: now };
  const log: ReviewLog = {
    id: uid(),
    cardId: card.id,
    deckId: card.deckId,
    rating,
    mode: opts.mode,
    stateBefore: card.state,
    reviewedAt: now,
  };
  if (opts.elapsedMs !== undefined) log.elapsedMs = opts.elapsedMs;
  await db.transaction('rw', [db.cards, db.reviewLogs], async () => {
    // Не «воскрешаем» удалённую карточку и не пишем лог-сироту
    if (!(await db.cards.get(card.id))) throw new CardNotFoundError(card.id);
    await db.cards.put(updated);
    await db.reviewLogs.add(log);
  });
  return { card: updated, log, previous: card };
}

/**
 * Откат ответа: вернуть прежнее состояние карточки и удалить запись журнала.
 * Если карточку успели удалить — бросает CardNotFoundError и ничего не меняет.
 */
export async function undoReview(res: ReviewResult): Promise<void> {
  await db.transaction('rw', [db.cards, db.reviewLogs], async () => {
    if (!(await db.cards.get(res.previous.id))) throw new CardNotFoundError(res.previous.id);
    await db.cards.put(res.previous);
    await db.reviewLogs.delete(res.log.id);
  });
}

// ---------- Экспорт ----------

export async function exportAll(now = Date.now()): Promise<BackupData> {
  return db.transaction('r', [db.decks, db.notes, db.cards, db.reviewLogs, db.settings], async () => {
    const [decks, notes, cards, reviewLogs, settings] = await Promise.all([
      db.decks.toArray(),
      db.notes.toArray(),
      db.cards.toArray(),
      db.reviewLogs.toArray(),
      db.settings.get('main'),
    ]);
    return buildBackup({ decks, notes, cards, reviewLogs, settings }, now);
  });
}
