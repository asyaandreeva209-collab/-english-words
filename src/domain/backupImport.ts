// Импорт резервной копии: разбор и проверка файла, миграция старых форматов, план объединения/замены.
// Чистая логика без Dexie — запись в БД в db/importBackup.ts.
import { z } from 'zod';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, toBackupSettings, type BackupSettings } from './backup';
import { MAX_LIMIT, legacyCardsLimitToWords } from './limits';
import { normalizeFront } from './parseList';
import { MAX_GOAL_CARDS, MAX_GOAL_MINUTES, withDefaults } from './settings';
import type { Card, Deck, Note, ReviewLog } from './types';

export type ImportMode = 'merge' | 'replace';

/** Ошибка импорта; message — готовый текст для пользователя. */
export class BackupImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupImportError';
  }
}

export interface Snapshot {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
  reviewLogs: ReviewLog[];
}

export interface ParsedBackup extends Snapshot {
  schemaVersion: number;
  exportedAt: number;
  settings: BackupSettings | null;
  /** duplicateIds — сколько записей с повторяющимся id отброшено внутри файла. */
  warnings: { duplicateIds: number };
}

export interface EntityStats {
  added: number;
  updated: number;
  unchanged: number;
}

export interface Dropped {
  notes: number;
  cards: number;
  reviewLogs: number;
}

export interface ImportPlan {
  /** Что записать в БД (для replace — всё, после очистки таблиц). */
  put: Snapshot;
  /** Каким станет содержимое БД после импорта. */
  result: Snapshot;
  stats: { decks: EntityStats; notes: EntityStats; cards: EntityStats; reviewLogs: EntityStats };
  /** Записи из файла с битыми ссылками (нет колоды/слова/карточки) — не импортируются. */
  dropped: Dropped;
  /** notes — новые слова, совпадающие с уже имеющимися в той же колоде; deckNames — одноимённые колоды. */
  possibleDuplicates: { notes: number; deckNames: string[] };
}

// ---------- Схема файла (текущая версия) ----------

const id = z.string().min(1);
const time = z.number().finite();
const count = z.number().int().nonnegative();
const limit = count.transform((n) => Math.min(n, MAX_LIMIT));
const cardState = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const DeckSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['vocab', 'grammar']),
  description: z.string().optional(),
  newPerDay: limit.optional(),
  createdAt: time,
  updatedAt: time,
  archived: z.boolean().optional(),
});

const NoteSchema = z.object({
  id,
  deckId: id,
  front: z.string(),
  back: z.string(),
  example: z.string().optional(),
  comment: z.string().optional(),
  transcription: z.string().optional(),
  createdAt: time,
  updatedAt: time,
});

const CardSchema = z.object({
  id,
  noteId: id,
  deckId: id,
  direction: z.enum(['fwd', 'rev']),
  due: time,
  stability: z.number().finite(),
  difficulty: z.number().finite(),
  elapsed_days: z.number().finite(),
  scheduled_days: z.number().finite(),
  learning_steps: count,
  reps: count,
  lapses: count,
  state: cardState,
  last_review: time.optional(),
  suspended: z.boolean().optional(),
  updatedAt: time,
});

const ReviewLogSchema = z.object({
  id,
  cardId: id,
  deckId: id,
  rating,
  mode: z.enum(['flash', 'type', 'choice']),
  stateBefore: cardState,
  reviewedAt: time,
  elapsedMs: z.number().finite().optional(),
});

// Ключ API и поля устройства в схеме не описаны — z.object их отбросит.
// Модель и уровень — любые строки: незнакомые значения заменит withDefaults.
const SettingsSchema = z
  .object({
    newPerDay: limit,
    desiredRetention: z.number().gt(0).lt(1),
    dayStartsAtHour: z.number().int().min(0).max(23),
    createReverse: z.boolean(),
    claudeModel: z.string(),
    englishLevel: z.string(),
    theme: z.enum(['system', 'light', 'dark']),
    ttsEnabled: z.boolean(),
    goalMinutes: count.transform((n) => Math.min(n, MAX_GOAL_MINUTES)),
    goalCards: count.transform((n) => Math.min(n, MAX_GOAL_CARDS)),
    goalMode: z.enum(['any', 'all']),
  })
  .partial()
  .nullable();

const BackupSchema = z.object({
  schemaVersion: z.number(),
  exportedAt: time,
  decks: z.array(DeckSchema),
  notes: z.array(NoteSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
  settings: SettingsSchema.optional(),
});

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Путь ошибки zod в виде notes[12].front. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || 'корень файла';
}

/** Лимит, который можно пересчитать; остальное оставляем как есть — его отклонит схема. */
const isValidLegacyLimit = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** Миграция сырого файла v1 → v2: лимит новых был в карточках, стал в словах. */
export function migrateBackup(raw: unknown): unknown {
  if (!isObject(raw) || raw.schemaVersion !== 1) return raw;
  const settings = isObject(raw.settings) ? raw.settings : null;
  const createReverse = typeof settings?.createReverse === 'boolean' ? settings.createReverse : true;
  const out: Record<string, unknown> = { ...raw, schemaVersion: 2 };
  if (settings && isValidLegacyLimit(settings.newPerDay)) {
    out.settings = { ...settings, newPerDay: legacyCardsLimitToWords(settings.newPerDay, createReverse) };
  }
  if (Array.isArray(raw.decks)) {
    out.decks = raw.decks.map((d: unknown) => {
      if (!isObject(d) || !isValidLegacyLimit(d.newPerDay)) return d;
      // Для грамматики одна карточка = одно слово (как в миграции БД v2)
      return { ...d, newPerDay: legacyCardsLimitToWords(d.newPerDay, d.kind === 'vocab' && createReverse) };
    });
  }
  return out;
}

/** Убирает повторы id: остаётся запись с бОльшим updatedAt (при равенстве — первая). */
function dedupeById<T extends { id: string }>(items: T[], newer: (a: T, b: T) => boolean): { items: T[]; duplicates: number } {
  const map = new Map<string, T>();
  let duplicates = 0;
  for (const x of items) {
    const prev = map.get(x.id);
    if (!prev) {
      map.set(x.id, x);
      continue;
    }
    duplicates++;
    if (newer(x, prev)) map.set(x.id, x);
  }
  return { items: [...map.values()], duplicates };
}

const byUpdatedAt = <T extends { updatedAt: number }>(a: T, b: T) => a.updatedAt > b.updatedAt;

/** Разбор файла копии. Любая ошибка — BackupImportError, частичного импорта нет. */
export function parseBackupJson(text: string): ParsedBackup {
  let raw: unknown;
  try {
    // BOM в начале (Блокнот Windows и т.п.) JSON.parse не принимает
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new BackupImportError('Это не JSON-файл');
  }
  if (!isObject(raw) || raw.app !== BACKUP_APP) {
    throw new BackupImportError('Это не резервная копия этого приложения');
  }
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new BackupImportError('Файл повреждён: schemaVersion');
  }
  if (v > BACKUP_SCHEMA_VERSION) {
    throw new BackupImportError(
      `Копия сделана более новой версией приложения (формат ${v}). Обновите приложение и повторите`,
    );
  }
  const res = BackupSchema.safeParse(migrateBackup(raw));
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new BackupImportError(`Файл повреждён: ${formatPath(issue?.path ?? [])}`);
  }
  const d = res.data;
  const decks = dedupeById<Deck>(d.decks, byUpdatedAt);
  const notes = dedupeById<Note>(d.notes, byUpdatedAt);
  const cards = dedupeById<Card>(d.cards, byUpdatedAt);
  const reviewLogs = dedupeById<ReviewLog>(d.reviewLogs, () => false);

  // Пустой объект настроек считаем отсутствием настроек, иначе withDefaults молча подставит значения по умолчанию
  const settings: BackupSettings | null = d.settings && Object.keys(d.settings).length > 0
    ? toBackupSettings(withDefaults(d.settings as Parameters<typeof withDefaults>[0]))
    : null;

  return {
    schemaVersion: v,
    exportedAt: d.exportedAt,
    decks: decks.items,
    notes: notes.items,
    cards: cards.items,
    reviewLogs: reviewLogs.items,
    settings,
    warnings: { duplicateIds: decks.duplicates + notes.duplicates + cards.duplicates + reviewLogs.duplicates },
  };
}

// ---------- План импорта ----------

/** Объединённая таблица: что сейчас в результате, что пришло из файла и что было локально. */
interface Table<T extends { id: string }> {
  map: Map<string, T>;
  local: Map<string, T>;
  /** id записей, взятых из файла. */
  fromFile: Set<string>;
  dropped: number;
}

function table<T extends { id: string }>(local: T[]): Table<T> {
  const m = new Map(local.map((x) => [x.id, x] as const));
  return { map: m, local: new Map(m), fromFile: new Set(), dropped: 0 };
}

/** Отбросить запись из файла: вернуть локальную версию, если была. */
function dropFromFile<T extends { id: string }>(t: Table<T>, rowId: string): void {
  t.fromFile.delete(rowId);
  const l = t.local.get(rowId);
  if (l) t.map.set(rowId, l);
  else t.map.delete(rowId);
  t.dropped++;
}

/**
 * Битые ссылки у записей из файла: заметка без колоды и карточка без заметки отбрасываются,
 * deckId карточки берётся у заметки, лог без карточки отбрасывается, deckId лога — от карточки.
 * Локальные записи не трогаем.
 */
function fixRefs(decks: Table<Deck>, notes: Table<Note>, cards: Table<Card>, logs: Table<ReviewLog>): void {
  for (const nid of [...notes.fromFile]) {
    const n = notes.map.get(nid)!;
    if (!decks.map.has(n.deckId)) dropFromFile(notes, nid);
  }
  for (const cid of [...cards.fromFile]) {
    const c = cards.map.get(cid)!;
    const note = notes.map.get(c.noteId);
    if (!note) dropFromFile(cards, cid);
    else if (c.deckId !== note.deckId) cards.map.set(cid, { ...c, deckId: note.deckId });
  }
  for (const lid of [...logs.fromFile]) {
    const l = logs.map.get(lid)!;
    const card = cards.map.get(l.cardId);
    if (!card) dropFromFile(logs, lid);
    else if (l.deckId !== card.deckId) logs.map.set(lid, { ...l, deckId: card.deckId });
  }
}

function addAll<T extends { id: string }>(t: Table<T>, items: T[]): void {
  for (const x of items) {
    t.map.set(x.id, x);
    t.fromFile.add(x.id);
  }
}

const values = <T extends { id: string }>(t: Table<T>): T[] => [...t.map.values()];
const fromFile = <T extends { id: string }>(t: Table<T>): T[] => [...t.fromFile].map((i) => t.map.get(i)!);

/** Проверка ссылок в снимке (как при замене): отбрасывает сироты, чинит deckId. */
export function sanitizeRefs(s: Snapshot): { data: Snapshot; dropped: Dropped } {
  const decks = table<Deck>(s.decks);
  const notes = table<Note>([]);
  const cards = table<Card>([]);
  const logs = table<ReviewLog>([]);
  addAll(notes, s.notes);
  addAll(cards, s.cards);
  addAll(logs, s.reviewLogs);
  fixRefs(decks, notes, cards, logs);
  return {
    data: { decks: s.decks, notes: values(notes), cards: values(cards), reviewLogs: values(logs) },
    dropped: { notes: notes.dropped, cards: cards.dropped, reviewLogs: logs.dropped },
  };
}

const allAdded = (n: number): EntityStats => ({ added: n, updated: 0, unchanged: 0 });

/** Замена: в БД останется только содержимое файла (без записей с битыми ссылками). */
export function planReplace(incoming: Snapshot): ImportPlan {
  const { data, dropped } = sanitizeRefs(incoming);
  return {
    put: data,
    result: data,
    stats: {
      decks: allAdded(data.decks.length),
      notes: allAdded(data.notes.length),
      cards: allAdded(data.cards.length),
      reviewLogs: allAdded(data.reviewLogs.length),
    },
    dropped,
    possibleDuplicates: { notes: 0, deckNames: [] },
  };
}

/** Записи из файла поверх локальных: новые добавляются, более новые (по updatedAt) заменяют локальные. */
function mergeInto<T extends { id: string; updatedAt: number }>(t: Table<T>, incoming: T[]): Set<string> {
  const added = new Set<string>();
  for (const x of incoming) {
    const l = t.local.get(x.id);
    if (l && x.updatedAt <= l.updatedAt) continue; // при равенстве побеждает локальная
    if (!l) added.add(x.id);
    t.map.set(x.id, x);
    t.fromFile.add(x.id);
  }
  return added;
}

function stats<T extends { id: string }>(t: Table<T>, added: Set<string>, incomingCount: number): EntityStats {
  let a = 0;
  for (const i of t.fromFile) if (added.has(i)) a++;
  const updated = t.fromFile.size - a;
  return { added: a, updated, unchanged: incomingCount - a - updated - t.dropped };
}

/**
 * Объединение: из двух версий одной записи остаётся более новая, отсутствующее в файле сохраняется.
 * История ответов только дополняется новыми записями.
 */
export function planMerge(local: Snapshot, incoming: Snapshot): ImportPlan {
  const decks = table(local.decks);
  const notes = table(local.notes);
  const cards = table(local.cards);
  const logs = table(local.reviewLogs);

  const addedDecks = mergeInto(decks, incoming.decks);
  const addedNotes = mergeInto(notes, incoming.notes);
  const addedCards = mergeInto(cards, incoming.cards);
  const addedLogs = new Set<string>();
  for (const l of incoming.reviewLogs) {
    if (logs.local.has(l.id)) continue;
    addedLogs.add(l.id);
    logs.map.set(l.id, l);
    logs.fromFile.add(l.id);
  }

  fixRefs(decks, notes, cards, logs);

  // Возможные дубликаты: новое слово с тем же текстом в той же колоде, но с другим id
  const resultNotes = values(notes);
  const byKey = new Map<string, number>();
  for (const n of resultNotes) {
    const key = `${n.deckId}\u0000${normalizeFront(n.front)}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  const addedByKey = new Map<string, number>();
  for (const nid of notes.fromFile) {
    if (!addedNotes.has(nid)) continue;
    const n = notes.map.get(nid)!;
    const key = `${n.deckId}\u0000${normalizeFront(n.front)}`;
    addedByKey.set(key, (addedByKey.get(key) ?? 0) + 1);
  }
  // Группа из k одинаковых слов — это k−1 лишних, но в счёт идут только добавленные из файла
  let dupNotes = 0;
  for (const [key, added] of addedByKey) dupNotes += Math.min(added, (byKey.get(key) ?? 1) - 1);

  const resultDecks = values(decks);
  const deckNames: string[] = [];
  for (const did of addedDecks) {
    const d = decks.map.get(did)!;
    const name = normalizeFront(d.name);
    if (resultDecks.some((o) => o.id !== d.id && normalizeFront(o.name) === name) && !deckNames.includes(d.name)) {
      deckNames.push(d.name);
    }
  }

  return {
    put: { decks: fromFile(decks), notes: fromFile(notes), cards: fromFile(cards), reviewLogs: fromFile(logs) },
    result: { decks: resultDecks, notes: resultNotes, cards: values(cards), reviewLogs: values(logs) },
    stats: {
      decks: stats(decks, addedDecks, incoming.decks.length),
      notes: stats(notes, addedNotes, incoming.notes.length),
      cards: stats(cards, addedCards, incoming.cards.length),
      reviewLogs: stats(logs, addedLogs, incoming.reviewLogs.length),
    },
    dropped: { notes: notes.dropped, cards: cards.dropped, reviewLogs: logs.dropped },
    possibleDuplicates: { notes: dupNotes, deckNames },
  };
}
