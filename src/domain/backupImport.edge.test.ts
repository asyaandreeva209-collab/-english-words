// Граничные случаи импорта резервной копии (чистая логика, без БД).
import { describe, expect, it } from 'vitest';
import { BACKUP_APP } from './backup';
import { BackupImportError, parseBackupJson, planMerge, planReplace, type Snapshot } from './backupImport';
import { shouldRemindBackup } from './backupReminder';
import { settingsAfterImport } from './settings';
import { DEFAULT_SETTINGS, type Card, type Deck, type Note, type ReviewLog } from './types';

const deck = (id: string, extra: Partial<Deck> = {}): Deck => ({
  id,
  name: `Deck ${id}`,
  kind: 'vocab',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const note = (id: string, deckId: string, extra: Partial<Note> = {}): Note => ({
  id,
  deckId,
  front: `word ${id}`,
  back: 'слово',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const card = (id: string, noteId: string, deckId: string, extra: Partial<Card> = {}): Card => ({
  id,
  noteId,
  deckId,
  direction: 'fwd',
  due: 1,
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  updatedAt: 1,
  ...extra,
});
const log = (id: string, cardId: string, deckId: string, extra: Partial<ReviewLog> = {}): ReviewLog => ({
  id,
  cardId,
  deckId,
  rating: 3,
  mode: 'flash',
  stateBefore: 0,
  reviewedAt: 1,
  ...extra,
});

const empty = (): Snapshot => ({ decks: [], notes: [], cards: [], reviewLogs: [] });
const full = (): Snapshot => ({
  decks: [deck('d1')],
  notes: [note('n1', 'd1')],
  cards: [card('c1', 'n1', 'd1')],
  reviewLogs: [log('l1', 'c1', 'd1')],
});

function fileObj(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { app: BACKUP_APP, schemaVersion: 2, exportedAt: 123, ...full(), settings: null, ...data };
}
const file = (data: Record<string, unknown> = {}) => JSON.stringify(fileObj(data));

function parseError(text: string): string {
  let err: unknown;
  try {
    parseBackupJson(text);
  } catch (e) {
    err = e;
  }
  expect(err, 'ожидалась ошибка').toBeInstanceOf(BackupImportError);
  return (err as Error).message;
}

/** Подставляет в JSON сырые токены (NaN/Infinity и т.п. нельзя выразить через JSON.stringify). */
function withRawToken(path: 'notes0.updatedAt' | 'cards0.due', token: string): string {
  const marker = '"__RAW__"';
  const o = fileObj();
  if (path === 'notes0.updatedAt') (o.notes as Record<string, unknown>[])[0]!.updatedAt = '__RAW__';
  else (o.cards as Record<string, unknown>[])[0]!.due = '__RAW__';
  return JSON.stringify(o).replace(marker, token);
}

describe('parseBackupJson: заголовок и кодировка', () => {
  it('пустая строка и null — понятные ошибки', () => {
    expect(parseError('')).toBe('Это не JSON-файл');
    expect(parseError('null')).toBe('Это не резервная копия этого приложения');
    expect(parseError('"english-words"')).toBe('Это не резервная копия этого приложения');
  });

  it('нет app — чужой файл', () => {
    const o = fileObj();
    delete o.app;
    expect(parseError(JSON.stringify(o))).toBe('Это не резервная копия этого приложения');
  });

  it('schemaVersion: дробная, отрицательная, отсутствует, null — повреждён', () => {
    expect(parseError(file({ schemaVersion: 1.5 }))).toBe('Файл повреждён: schemaVersion');
    expect(parseError(file({ schemaVersion: -1 }))).toBe('Файл повреждён: schemaVersion');
    expect(parseError(file({ schemaVersion: null }))).toBe('Файл повреждён: schemaVersion');
    const o = fileObj();
    delete o.schemaVersion;
    expect(parseError(JSON.stringify(o))).toBe('Файл повреждён: schemaVersion');
  });

  it('schemaVersion 2.0 в тексте — это целое 2', () => {
    expect(parseBackupJson(file().replace('"schemaVersion":2', '"schemaVersion":2.0')).schemaVersion).toBe(2);
  });

  it('огромная версия — сообщение про новую версию приложения, а не «повреждён»', () => {
    expect(parseError(file({ schemaVersion: 1000 }))).toContain('формат 1000');
  });

  it('отсутствует обязательный массив — путь к нему', () => {
    const o = fileObj();
    delete o.notes;
    expect(parseError(JSON.stringify(o))).toBe('Файл повреждён: notes');
    expect(parseError(file({ cards: {} }))).toBe('Файл повреждён: cards');
  });

  it('Unicode в тексте сохраняется без искажений', () => {
    const front = 'naïve café — «ёжик» 漢字 😀';
    const p = parseBackupJson(file({ notes: [note('n1', 'd1', { front, comment: '\u0000 ' })] }));
    expect(p.notes[0]?.front).toBe(front);
    expect(p.notes[0]?.comment).toBe('\u0000 ');
  });

  it('BOM: file.text() (Blob) его срезает — файл с BOM читается', async () => {
    const text = await new Blob(['﻿' + file()], { type: 'application/json' }).text();
    expect(parseBackupJson(text).notes).toHaveLength(1);
  });

  it('BOM в самой строке срезается — файл читается', () => {
    expect(parseBackupJson('﻿' + file()).notes).toHaveLength(1);
  });

  it('пробелы и переводы строк вокруг JSON допустимы', () => {
    expect(parseBackupJson('\r\n  ' + JSON.stringify(fileObj(), null, 2) + '\n\n').decks).toHaveLength(1);
  });
});

describe('parseBackupJson: числа', () => {
  it('NaN / Infinity / -Infinity не JSON — «Это не JSON-файл»', () => {
    expect(parseError(withRawToken('notes0.updatedAt', 'NaN'))).toBe('Это не JSON-файл');
    expect(parseError(withRawToken('notes0.updatedAt', 'Infinity'))).toBe('Это не JSON-файл');
    expect(parseError(withRawToken('cards0.due', '-Infinity'))).toBe('Это не JSON-файл');
  });

  it('1e999 (JSON.parse → Infinity) — повреждён с путём', () => {
    expect(parseError(withRawToken('notes0.updatedAt', '1e999'))).toBe('Файл повреждён: notes[0].updatedAt');
    expect(parseError(withRawToken('cards0.due', '-1e999'))).toBe('Файл повреждён: cards[0].due');
  });

  it('строка вместо числа — повреждён с путём', () => {
    expect(parseError(file({ notes: [note('n0', 'd1'), { ...note('n1', 'd1'), updatedAt: '5' }] }))).toBe(
      'Файл повреждён: notes[1].updatedAt',
    );
    expect(parseError(file({ cards: [{ ...card('c1', 'n1', 'd1'), reps: '1' }] }))).toBe('Файл повреждён: cards[0].reps');
    expect(parseError(file({ reviewLogs: [{ ...log('l1', 'c1', 'd1'), rating: '3' }] }))).toBe(
      'Файл повреждён: reviewLogs[0].rating',
    );
  });

  it('счётчики: отрицательные и дробные отклоняются', () => {
    expect(parseError(file({ cards: [card('c1', 'n1', 'd1', { reps: -1 })] }))).toBe('Файл повреждён: cards[0].reps');
    expect(parseError(file({ cards: [card('c1', 'n1', 'd1', { lapses: 0.5 })] }))).toBe('Файл повреждён: cards[0].lapses');
    expect(parseError(file({ cards: [card('c1', 'n1', 'd1', { learning_steps: -2 })] }))).toBe(
      'Файл повреждён: cards[0].learning_steps',
    );
  });

  it('большие конечные числа и отрицательные даты принимаются как есть', () => {
    const p = parseBackupJson(
      file({
        decks: [deck('d1', { createdAt: -86_400_000, updatedAt: Number.MAX_VALUE })],
        cards: [card('c1', 'n1', 'd1', { due: -1, reps: Number.MAX_SAFE_INTEGER, stability: 1e300 })],
      }),
    );
    expect(p.decks[0]?.createdAt).toBe(-86_400_000);
    expect(p.decks[0]?.updatedAt).toBe(Number.MAX_VALUE);
    expect(p.cards[0]?.due).toBe(-1);
    expect(p.cards[0]?.reps).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('лимит колоды больше MAX_LIMIT обрезается до 200, отрицательный — ошибка', () => {
    expect(parseBackupJson(file({ decks: [deck('d1', { newPerDay: 10_000 })] })).decks[0]?.newPerDay).toBe(200);
    expect(parseError(file({ decks: [deck('d1', { newPerDay: -1 })] }))).toBe('Файл повреждён: decks[0].newPerDay');
  });

  it('настройки: строка вместо числа, retention вне (0,1), час 24 — ошибка с путём', () => {
    expect(parseError(file({ settings: { newPerDay: '10' } }))).toBe('Файл повреждён: settings.newPerDay');
    expect(parseError(file({ settings: { desiredRetention: 1 } }))).toBe('Файл повреждён: settings.desiredRetention');
    expect(parseError(file({ settings: { dayStartsAtHour: 24 } }))).toBe('Файл повреждён: settings.dayStartsAtHour');
    expect(parseError(file({ settings: [] }))).toContain('Файл повреждён: settings');
  });

  it('пустые настройки {} → null (не затираем настройки устройства значениями по умолчанию)', () => {
    expect(parseBackupJson(file({ settings: {} })).settings).toBeNull();
  });

  it('отсутствующие settings → null', () => {
    const o = fileObj();
    delete o.settings;
    expect(parseBackupJson(JSON.stringify(o)).settings).toBeNull();
  });

  it('пустой id отклоняется', () => {
    expect(parseError(file({ notes: [note('', 'd1')] }))).toBe('Файл повреждён: notes[0].id');
  });

  it('первая ошибка в сообщении, даже если ошибок несколько', () => {
    const msg = parseError(file({ notes: [note('n1', 'd1'), { ...note('n2', 'd1'), front: 1 }, { back: 2 }] }));
    expect(msg).toBe('Файл повреждён: notes[1].front');
  });
});

describe('parseBackupJson: дубликаты id', () => {
  it('при равном updatedAt остаётся первая запись', () => {
    const p = parseBackupJson(
      file({ notes: [note('n1', 'd1', { front: 'first', updatedAt: 5 }), note('n1', 'd1', { front: 'second', updatedAt: 5 })] }),
    );
    expect(p.notes.map((n) => n.front)).toEqual(['first']);
    expect(p.warnings.duplicateIds).toBe(1);
  });

  it('новейшая из трёх, даже если стоит в середине; колоды и карточки тоже', () => {
    const p = parseBackupJson(
      file({
        decks: [deck('d1', { name: 'a', updatedAt: 1 }), deck('d1', { name: 'b', updatedAt: 9 }), deck('d1', { name: 'c', updatedAt: 3 })],
        cards: [card('c1', 'n1', 'd1', { reps: 1, updatedAt: 2 }), card('c1', 'n1', 'd1', { reps: 7, updatedAt: 8 })],
      }),
    );
    expect(p.decks).toHaveLength(1);
    expect(p.decks[0]?.name).toBe('b');
    expect(p.cards[0]?.reps).toBe(7);
    expect(p.warnings.duplicateIds).toBe(3);
  });

  it('одинаковый id в разных таблицах — это не дубликат', () => {
    const p = parseBackupJson(
      file({ decks: [deck('x')], notes: [note('x', 'x')], cards: [card('x', 'x', 'x')], reviewLogs: [log('x', 'x', 'x')] }),
    );
    expect(p.warnings.duplicateIds).toBe(0);
  });
});

describe('parseBackupJson: v1 (старый экспорт)', () => {
  // Так выглядел экспорт до v2: лимиты в карточках, settings целиком из БД (с id 'main'),
  // модель-заглушка до миграции БД v3, полей englishLevel/theme ещё могло не быть.
  const oldExport = {
    app: 'english-words',
    schemaVersion: 1,
    exportedAt: 1_760_000_000_000,
    decks: [
      { id: 'd-v', name: 'Еда', kind: 'vocab', newPerDay: 15, createdAt: 1, updatedAt: 2 },
      { id: 'd-g', name: 'Времена', kind: 'grammar', newPerDay: 15, createdAt: 1, updatedAt: 2 },
      { id: 'd-0', name: 'Пауза', kind: 'vocab', newPerDay: 0, createdAt: 1, updatedAt: 2 },
      { id: 'd-1', name: 'Один', kind: 'vocab', newPerDay: 1, createdAt: 1, updatedAt: 2 },
      { id: 'd-n', name: 'Без лимита', kind: 'vocab', createdAt: 1, updatedAt: 2 },
    ],
    notes: [{ id: 'n1', deckId: 'd-v', front: 'apple', back: 'яблоко', createdAt: 1, updatedAt: 1 }],
    cards: [
      {
        id: 'c1',
        noteId: 'n1',
        deckId: 'd-v',
        direction: 'fwd',
        due: 1_760_000_600_000,
        stability: 2.3065,
        difficulty: 2.11810397,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 1,
        reps: 1,
        lapses: 0,
        state: 1,
        last_review: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
      },
    ],
    reviewLogs: [
      { id: 'l1', cardId: 'c1', deckId: 'd-v', rating: 3, mode: 'flash', stateBefore: 0, reviewedAt: 1_760_000_000_000, elapsedMs: 1200 },
    ],
    settings: {
      id: 'main',
      newPerDay: 21,
      desiredRetention: 0.9,
      dayStartsAtHour: 4,
      createReverse: true,
      claudeApiKey: 'sk-ant-OLD',
      claudeModel: 'claude-sonnet-4-5',
    },
  };

  it('лимиты пересчитаны (вверх, минимум 1, 0 остаётся 0), грамматика не делится', () => {
    const p = parseBackupJson(JSON.stringify(oldExport));
    const lim = Object.fromEntries(p.decks.map((d) => [d.id, d.newPerDay]));
    expect(lim).toEqual({ 'd-v': 8, 'd-g': 15, 'd-0': 0, 'd-1': 1, 'd-n': undefined });
    expect(p.settings?.newPerDay).toBe(11);
  });

  it('модель-заглушка → по умолчанию, отсутствующие поля → по умолчанию, ключа нет', () => {
    const p = parseBackupJson(JSON.stringify(oldExport));
    expect(p.settings?.claudeModel).toBe(DEFAULT_SETTINGS.claudeModel);
    expect(p.settings?.englishLevel).toBe(DEFAULT_SETTINGS.englishLevel);
    expect(p.settings?.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(p.settings).not.toHaveProperty('claudeApiKey');
    expect(JSON.stringify(p)).not.toContain('sk-ant-OLD');
  });

  it('карточки и история — без изменений', () => {
    const p = parseBackupJson(JSON.stringify(oldExport));
    expect(p.cards).toEqual(oldExport.cards);
    expect(p.reviewLogs).toEqual(oldExport.reviewLogs);
    expect(p.schemaVersion).toBe(1);
  });

  it('v1 с settings: null и createReverse не задан — делим на 2 (как миграция БД)', () => {
    const p = parseBackupJson(JSON.stringify({ ...oldExport, settings: null }));
    expect(p.settings).toBeNull();
    expect(p.decks.find((d) => d.id === 'd-v')?.newPerDay).toBe(8);
  });

  it('v1: огромный лимит в карточках — делится и затем обрезается до 200', () => {
    const p = parseBackupJson(JSON.stringify({ ...oldExport, settings: { newPerDay: 1000 } }));
    expect(p.settings?.newPerDay).toBe(200);
  });

  it('v1: битый лимит — ошибка с путём, а не исключение миграции', () => {
    expect(parseError(JSON.stringify({ ...oldExport, settings: { newPerDay: '20' } }))).toBe(
      'Файл повреждён: settings.newPerDay',
    );
    expect(parseError(JSON.stringify({ ...oldExport, decks: 'oops' }))).toBe('Файл повреждён: decks');
  });

  // БАГ: migrateBackup пересчитывает лимит ДО проверки zod, а legacyCardsLimitToWords
  // превращает отрицательные/дробные значения в допустимые (max(1, ceil(x/2))).
  // В v2 такой файл отклоняется (см. «лимит колоды ... отрицательный — ошибка»), в v1 — молча принимается.
  it('v1: отрицательный/дробный лимит отклоняется так же, как в v2', () => {
    expect(parseError(JSON.stringify({ ...oldExport, decks: [{ ...oldExport.decks[0], newPerDay: -4 }] }))).toBe(
      'Файл повреждён: decks[0].newPerDay',
    );
    expect(parseError(JSON.stringify({ ...oldExport, settings: { newPerDay: 2.5 } }))).toBe(
      'Файл повреждён: settings.newPerDay',
    );
  });

  it('v2-файл не мигрируется повторно', () => {
    const p = parseBackupJson(JSON.stringify({ ...oldExport, schemaVersion: 2 }));
    expect(p.decks.find((d) => d.id === 'd-v')?.newPerDay).toBe(15);
    expect(p.settings?.newPerDay).toBe(21);
  });
});

describe('planMerge: граничные случаи', () => {
  it('пустой файл: ничего не меняется', () => {
    const local = full();
    const plan = planMerge(local, empty());
    expect(plan.put).toEqual(empty());
    expect(plan.result).toEqual(local);
    for (const s of Object.values(plan.stats)) expect(s).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(plan.dropped).toEqual({ notes: 0, cards: 0, reviewLogs: 0 });
  });

  it('пустая БД + пустой файл', () => {
    const plan = planMerge(empty(), empty());
    expect(plan.result).toEqual(empty());
    expect(plan.possibleDuplicates).toEqual({ notes: 0, deckNames: [] });
  });

  it('пустая БД: весь файл добавляется', () => {
    const plan = planMerge(empty(), full());
    expect(plan.put).toEqual(full());
    for (const s of Object.values(plan.stats)) expect(s).toEqual({ added: 1, updated: 0, unchanged: 0 });
  });

  it('файл = локальные данные → всё «без изменений», put пуст (идемпотентность)', () => {
    const local = full();
    const plan = planMerge(local, full());
    expect(plan.put).toEqual(empty());
    expect(plan.result).toEqual(local);
    for (const s of Object.values(plan.stats)) expect(s).toEqual({ added: 0, updated: 0, unchanged: 1 });
    // повторное объединение результата с тем же файлом — тот же итог
    const again = planMerge(plan.result, full());
    expect(again.result).toEqual(plan.result);
    expect(again.put).toEqual(empty());
  });

  it('заметка в файле новее, а её колода в файле старее: заметка обновляется, колода — нет', () => {
    const local: Snapshot = { ...empty(), decks: [deck('d1', { name: 'Локальная', updatedAt: 10 })], notes: [note('n1', 'd1', { back: 'старое', updatedAt: 1 })] };
    const plan = planMerge(local, {
      ...empty(),
      decks: [deck('d1', { name: 'Из файла', updatedAt: 5 })],
      notes: [note('n1', 'd1', { back: 'новое', updatedAt: 20 })],
    });
    expect(plan.result.decks).toEqual([deck('d1', { name: 'Локальная', updatedAt: 10 })]);
    expect(plan.result.notes[0]?.back).toBe('новое');
    expect(plan.stats.decks).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(plan.stats.notes).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect(plan.put.decks).toEqual([]);
  });

  it('карточка из файла ссылается на заметку, которая есть только локально — принимается', () => {
    const local: Snapshot = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1')] };
    const plan = planMerge(local, { ...empty(), cards: [card('c1', 'n1', 'd1')], reviewLogs: [log('l1', 'c1', 'd1')] });
    expect(plan.put.cards.map((c) => c.id)).toEqual(['c1']);
    expect(plan.put.reviewLogs.map((l) => l.id)).toEqual(['l1']);
    expect(plan.dropped).toEqual({ notes: 0, cards: 0, reviewLogs: 0 });
  });

  it('лог из файла для локальной карточки — принимается, deckId берётся у карточки', () => {
    const local: Snapshot = { decks: [deck('d1')], notes: [note('n1', 'd1')], cards: [card('c1', 'n1', 'd1')], reviewLogs: [] };
    const plan = planMerge(local, { ...empty(), reviewLogs: [log('l9', 'c1', 'dX')] });
    expect(plan.put.reviewLogs).toEqual([log('l9', 'c1', 'd1')]);
  });

  it('заметка из файла в колоде, которая есть только в файле — принимается', () => {
    const plan = planMerge({ ...empty(), decks: [deck('d1')] }, { ...empty(), decks: [deck('d2')], notes: [note('n2', 'd2')] });
    expect(plan.result.notes.map((n) => n.id)).toEqual(['n2']);
    expect(plan.dropped.notes).toBe(0);
  });

  it('каскад: заметка из файла отброшена → её карточки и логи из файла тоже', () => {
    const plan = planMerge(
      { ...empty(), decks: [deck('d1')] },
      { ...empty(), notes: [note('n1', 'dX')], cards: [card('c1', 'n1', 'dX'), card('c2', 'n1', 'dX')], reviewLogs: [log('l1', 'c1', 'dX')] },
    );
    expect(plan.dropped).toEqual({ notes: 1, cards: 2, reviewLogs: 1 });
    expect(plan.put).toEqual(empty());
    expect(plan.result).toEqual({ ...empty(), decks: [deck('d1')] });
    expect(plan.stats.notes).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(plan.stats.cards).toEqual({ added: 0, updated: 0, unchanged: 0 });
  });

  it('отброшенное обновление карточки (заметки нет нигде) не затирает локальную карточку', () => {
    const localCard = card('c1', 'n1', 'd1', { reps: 5, updatedAt: 1 });
    const local: Snapshot = { decks: [deck('d1')], notes: [note('n1', 'd1')], cards: [localCard], reviewLogs: [] };
    const plan = planMerge(local, { ...empty(), cards: [card('c1', 'nX', 'd1', { reps: 99, updatedAt: 50 })] });
    expect(plan.result.cards).toEqual([localCard]);
    expect(plan.put.cards).toEqual([]);
    expect(plan.dropped.cards).toBe(1);
  });

  it('отброшенное обновление заметки: локальные карточки этой заметки остаются как были', () => {
    const local = full();
    const plan = planMerge(local, { ...empty(), notes: [note('n1', 'dX', { updatedAt: 99 })], cards: [card('c1', 'n1', 'dX', { reps: 3, updatedAt: 99 })] });
    // заметка отброшена, а карточка из файла новее — она применяется, но deckId приводится к локальной заметке
    expect(plan.result.notes).toEqual(local.notes);
    expect(plan.result.cards).toEqual([card('c1', 'n1', 'd1', { reps: 3, updatedAt: 99 })]);
  });

  it('сумма added+updated+unchanged+dropped = числу записей в файле', () => {
    const local: Snapshot = {
      decks: [deck('d1')],
      notes: [note('n1', 'd1', { updatedAt: 5 }), note('n2', 'd1', { updatedAt: 5 })],
      cards: [],
      reviewLogs: [],
    };
    const incoming: Snapshot = {
      ...empty(),
      notes: [note('n1', 'd1', { updatedAt: 9 }), note('n2', 'd1', { updatedAt: 1 }), note('n3', 'd1'), note('n4', 'dX')],
    };
    const plan = planMerge(local, incoming);
    const s = plan.stats.notes;
    expect(s).toEqual({ added: 1, updated: 1, unchanged: 1 });
    expect(s.added + s.updated + s.unchanged + plan.dropped.notes).toBe(incoming.notes.length);
  });

  it('дубликат слова внутри одной колоды — считается, в другой колоде — нет', () => {
    const local: Snapshot = { ...empty(), decks: [deck('d1'), deck('d2')], notes: [note('n1', 'd1', { front: 'Apple' })] };
    const plan = planMerge(local, {
      ...empty(),
      notes: [note('n2', 'd1', { front: 'apple' }), note('n3', 'd2', { front: 'apple' }), note('n4', 'd1', { front: 'APPLE ' })],
    });
    expect(plan.result.notes).toHaveLength(4);
    expect(plan.possibleDuplicates.notes).toBe(2);
  });

  it('обновлённая (не новая) заметка не считается дубликатом', () => {
    const local: Snapshot = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1', { front: 'apple', updatedAt: 1 })] };
    const plan = planMerge(local, { ...empty(), notes: [note('n1', 'd1', { front: 'apple', updatedAt: 2 })] });
    expect(plan.possibleDuplicates.notes).toBe(0);
  });
});

describe('planReplace: граничные случаи', () => {
  it('пустой файл → пустая БД', () => {
    const plan = planReplace(empty());
    expect(plan.put).toEqual(empty());
    expect(plan.result).toEqual(empty());
    expect(plan.dropped).toEqual({ notes: 0, cards: 0, reviewLogs: 0 });
  });

  it('каскад битых ссылок и исправление deckId', () => {
    const plan = planReplace({
      decks: [deck('d1'), deck('d2')],
      notes: [note('n1', 'd2'), note('n2', 'dX')],
      cards: [card('c1', 'n1', 'd1'), card('c2', 'n2', 'dX')],
      reviewLogs: [log('l1', 'c1', 'd1'), log('l2', 'c2', 'dX')],
    });
    expect(plan.result.cards).toEqual([card('c1', 'n1', 'd2')]);
    expect(plan.result.reviewLogs).toEqual([log('l1', 'c1', 'd2')]);
    expect(plan.dropped).toEqual({ notes: 1, cards: 1, reviewLogs: 1 });
  });
});

describe('settingsAfterImport: граничные случаи', () => {
  it('replace с файлом без настроек сохраняет всё текущее, включая ключ', () => {
    const current = { ...DEFAULT_SETTINGS, claudeApiKey: 'k', theme: 'dark' as const };
    expect(settingsAfterImport(current, null, 'replace')).toEqual(current);
  });

  it('replace: даже если в incoming каким-то образом есть ключ — берётся ключ устройства', () => {
    const incoming = { ...DEFAULT_SETTINGS, claudeApiKey: 'FILE', lastBackupAt: 1, backupReminderSnoozeUntil: 2 } as never;
    const s = settingsAfterImport({ ...DEFAULT_SETTINGS }, incoming, 'replace');
    expect(s).not.toHaveProperty('claudeApiKey');
    expect(s).not.toHaveProperty('lastBackupAt');
    expect(s).not.toHaveProperty('backupReminderSnoozeUntil');
    expect(s.id).toBe('main');
  });
});

describe('shouldRemindBackup: граничные случаи', () => {
  const DAY = 86_400_000;
  const NOW = new Date(2026, 0, 15, 12).getTime();

  it('копия была, но слов 0 — не напоминаем', () => {
    expect(shouldRemindBackup({ noteCount: 0, lastBackupAt: 0, now: NOW })).toBe(false);
  });

  it('копия была давно — напоминаем даже при 1 слове (порог 20 только без копии)', () => {
    expect(shouldRemindBackup({ noteCount: 1, lastBackupAt: NOW - 30 * DAY, now: NOW })).toBe(true);
  });

  it('lastBackupAt = 0 считается копией (а не «не было»)', () => {
    expect(shouldRemindBackup({ noteCount: 5, lastBackupAt: 0, now: NOW })).toBe(true);
  });

  it('отсрочка в прошлом не мешает; отсрочка перекрывает и порог «без копии»', () => {
    expect(shouldRemindBackup({ noteCount: 5, lastBackupAt: NOW - 8 * DAY, snoozeUntil: NOW - 1, now: NOW })).toBe(true);
    expect(shouldRemindBackup({ noteCount: 500, snoozeUntil: NOW + DAY, now: NOW })).toBe(false);
  });

  it('копия «из будущего» (часы сдвинуты) — не напоминаем', () => {
    expect(shouldRemindBackup({ noteCount: 50, lastBackupAt: NOW + DAY, now: NOW })).toBe(false);
  });
});
