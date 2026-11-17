import { describe, expect, it } from 'vitest';
import { BACKUP_APP } from './backup';
import {
  BackupImportError,
  parseBackupJson,
  planMerge,
  planReplace,
  sanitizeRefs,
  type Snapshot,
} from './backupImport';
import { settingsAfterImport } from './settings';
import { DEFAULT_SETTINGS, type Card, type Deck, type Note, type ReviewLog, type Settings } from './types';

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
const log = (id: string, cardId: string, deckId: string): ReviewLog => ({
  id,
  cardId,
  deckId,
  rating: 3,
  mode: 'flash',
  stateBefore: 0,
  reviewedAt: 1,
});

const empty = (): Snapshot => ({ decks: [], notes: [], cards: [], reviewLogs: [] });

function file(data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: BACKUP_APP,
    schemaVersion: 2,
    exportedAt: 123,
    decks: [deck('d1')],
    notes: [note('n1', 'd1')],
    cards: [card('c1', 'n1', 'd1')],
    reviewLogs: [log('l1', 'c1', 'd1')],
    settings: null,
    ...data,
  });
}

function parseError(text: string): string {
  try {
    parseBackupJson(text);
  } catch (e) {
    expect(e).toBeInstanceOf(BackupImportError);
    return (e as Error).message;
  }
  throw new Error('ожидалась ошибка');
}

describe('parseBackupJson', () => {
  it('корректный файл', () => {
    const p = parseBackupJson(file());
    expect(p.exportedAt).toBe(123);
    expect(p.decks).toEqual([deck('d1')]);
    expect(p.cards).toEqual([card('c1', 'n1', 'd1')]);
    expect(p.settings).toBeNull();
    expect(p.warnings.duplicateIds).toBe(0);
  });

  it('не JSON', () => {
    expect(parseError('{oops')).toBe('Это не JSON-файл');
  });

  it('чужой app или не объект', () => {
    expect(parseError(file({ app: 'other' }))).toBe('Это не резервная копия этого приложения');
    expect(parseError('[1,2]')).toBe('Это не резервная копия этого приложения');
  });

  it('более новая версия формата', () => {
    expect(parseError(file({ schemaVersion: 3 }))).toContain('более новой версией приложения (формат 3)');
  });

  it('schemaVersion 0 или строка — повреждён', () => {
    expect(parseError(file({ schemaVersion: 0 }))).toContain('Файл повреждён');
    expect(parseError(file({ schemaVersion: '2' }))).toContain('Файл повреждён');
  });

  it('битая карточка — сообщение с путём, весь файл отклонён', () => {
    const cards = [card('c0', 'n1', 'd1'), { ...card('c1', 'n1', 'd1'), state: 7 }];
    expect(parseError(file({ cards }))).toBe('Файл повреждён: cards[1].state');
  });

  it('лишние поля отброшены', () => {
    const p = parseBackupJson(file({ decks: [{ ...deck('d1'), junk: 1 }], extra: true }));
    expect(p.decks[0]).not.toHaveProperty('junk');
    expect(p).not.toHaveProperty('extra');
  });

  it('claudeApiKey и поля устройства из файла не попадают', () => {
    const p = parseBackupJson(
      file({ settings: { ...DEFAULT_SETTINGS, newPerDay: 7, claudeApiKey: 'sk-ant-X', lastBackupAt: 5, backupReminderSnoozeUntil: 6 } }),
    );
    expect(p.settings?.newPerDay).toBe(7);
    expect(p.settings).not.toHaveProperty('claudeApiKey');
    expect(p.settings).not.toHaveProperty('lastBackupAt');
    expect(p.settings).not.toHaveProperty('backupReminderSnoozeUntil');
  });

  it('дневная цель проходит через импорт', () => {
    const p = parseBackupJson(file({ settings: { ...DEFAULT_SETTINGS, goalMinutes: 15, goalCards: 0, goalMode: 'all' } }));
    expect(p.settings).toMatchObject({ goalMinutes: 15, goalCards: 0, goalMode: 'all' });
  });

  it('дневная цель: слишком большие значения урезаются до максимума', () => {
    const p = parseBackupJson(file({ settings: { goalCards: 9999, goalMinutes: 1000 } }));
    expect(p.settings).toMatchObject({ goalCards: 500, goalMinutes: 120 });
  });

  it('дневная цель: неизвестный режим или отрицательный порог — файл отклонён', () => {
    expect(parseError(file({ settings: { goalMode: 'x' } }))).toBe('Файл повреждён: settings.goalMode');
    expect(parseError(file({ settings: { goalCards: -1 } }))).toBe('Файл повреждён: settings.goalCards');
    expect(parseError(file({ settings: { goalMinutes: 2.5 } }))).toBe('Файл повреждён: settings.goalMinutes');
  });

  it('неполные настройки дополняются значениями по умолчанию', () => {
    const p = parseBackupJson(file({ settings: { theme: 'dark', claudeModel: 'claude-sonnet-4-5' } }));
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
  });

  it('v1: лимит в карточках переводится в слова, у грамматики не делится', () => {
    const p = parseBackupJson(
      file({
        schemaVersion: 1,
        decks: [deck('d1', { newPerDay: 20 }), deck('g1', { kind: 'grammar', newPerDay: 20 })],
        settings: { ...DEFAULT_SETTINGS, newPerDay: 20 },
      }),
    );
    expect(p.schemaVersion).toBe(1);
    expect(p.settings?.newPerDay).toBe(10);
    expect(p.decks.find((d) => d.id === 'd1')?.newPerDay).toBe(10);
    expect(p.decks.find((d) => d.id === 'g1')?.newPerDay).toBe(20);
  });

  it('v1 без обратных карточек: лимит не делится', () => {
    const p = parseBackupJson(
      file({ schemaVersion: 1, decks: [deck('d1', { newPerDay: 20 })], settings: { createReverse: false, newPerDay: 20 } }),
    );
    expect(p.settings?.newPerDay).toBe(20);
    expect(p.decks[0]?.newPerDay).toBe(20);
  });

  it('дубликаты id: остаётся более новая запись, для логов — первая', () => {
    const p = parseBackupJson(
      file({
        notes: [note('n1', 'd1', { front: 'old', updatedAt: 1 }), note('n1', 'd1', { front: 'new', updatedAt: 5 })],
        reviewLogs: [log('l1', 'c1', 'd1'), { ...log('l1', 'c1', 'd1'), rating: 1 }],
      }),
    );
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]?.front).toBe('new');
    expect(p.reviewLogs).toHaveLength(1);
    expect(p.reviewLogs[0]?.rating).toBe(3);
    expect(p.warnings.duplicateIds).toBe(2);
  });
});

describe('sanitizeRefs', () => {
  it('сироты отбрасываются, deckId карточки и лога исправляются', () => {
    const { data, dropped } = sanitizeRefs({
      decks: [deck('d1'), deck('d2')],
      notes: [note('n1', 'd1'), note('n2', 'missing')],
      cards: [card('c1', 'n1', 'd2'), card('c2', 'n2', 'd1'), card('c3', 'nX', 'd1')],
      reviewLogs: [log('l1', 'c1', 'd2'), log('l2', 'c2', 'd1')],
    });
    expect(data.notes.map((n) => n.id)).toEqual(['n1']);
    expect(data.cards).toEqual([card('c1', 'n1', 'd1')]);
    expect(data.reviewLogs).toEqual([log('l1', 'c1', 'd1')]);
    expect(dropped).toEqual({ notes: 1, cards: 2, reviewLogs: 1 });
  });
});

describe('planReplace', () => {
  it('результат — только содержимое файла', () => {
    const plan = planReplace({ ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1'), note('n2', 'dX')] });
    expect(plan.result.notes.map((n) => n.id)).toEqual(['n1']);
    expect(plan.put).toEqual(plan.result);
    expect(plan.stats.notes).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.dropped.notes).toBe(1);
  });
});

describe('planMerge', () => {
  it('новые записи добавляются, отсутствующие в файле сохраняются', () => {
    const local = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1')] };
    const plan = planMerge(local, { ...empty(), decks: [deck('d2')], notes: [note('n2', 'd2')] });
    expect(plan.stats.decks).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.stats.notes).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.result.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(plan.put.notes.map((n) => n.id)).toEqual(['n2']);
  });

  it('более новая из файла заменяет локальную', () => {
    const local = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1', { back: 'старое', updatedAt: 1 })] };
    const plan = planMerge(local, { ...empty(), notes: [note('n1', 'd1', { back: 'новое', updatedAt: 2 })] });
    expect(plan.stats.notes).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect(plan.result.notes[0]?.back).toBe('новое');
    expect(plan.put.notes).toHaveLength(1);
  });

  it('равная или более старая — локальная остаётся', () => {
    const local = {
      ...empty(),
      decks: [deck('d1')],
      notes: [note('n1', 'd1', { back: 'моё', updatedAt: 5 }), note('n2', 'd1', { back: 'моё', updatedAt: 5 })],
    };
    const plan = planMerge(local, {
      ...empty(),
      notes: [note('n1', 'd1', { back: 'файл', updatedAt: 5 }), note('n2', 'd1', { back: 'файл', updatedAt: 3 })],
    });
    expect(plan.stats.notes).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(plan.result.notes.map((n) => n.back)).toEqual(['моё', 'моё']);
    expect(plan.put.notes).toEqual([]);
  });

  it('история: добавляются только новые id', () => {
    const base = { decks: [deck('d1')], notes: [note('n1', 'd1')], cards: [card('c1', 'n1', 'd1')] };
    const local = { ...base, reviewLogs: [log('l1', 'c1', 'd1')] };
    const plan = planMerge(local, { ...base, reviewLogs: [{ ...log('l1', 'c1', 'd1'), rating: 1 }, log('l2', 'c1', 'd1')] });
    expect(plan.stats.reviewLogs).toEqual({ added: 1, updated: 0, unchanged: 1 });
    expect(plan.put.reviewLogs.map((l) => l.id)).toEqual(['l2']);
    expect(plan.result.reviewLogs.find((l) => l.id === 'l1')?.rating).toBe(3);
  });

  it('битые ссылки в файле отбрасываются, локальные не трогаются', () => {
    const local = { ...empty(), decks: [deck('d1'), deck('d2')], notes: [note('n1', 'd1')] };
    const plan = planMerge(local, {
      ...empty(),
      notes: [note('n2', 'dX')],
      cards: [card('c1', 'n1', 'd2'), card('c2', 'nX', 'd1')],
      reviewLogs: [log('l1', 'cX', 'd1')],
    });
    expect(plan.dropped).toEqual({ notes: 1, cards: 1, reviewLogs: 1 });
    expect(plan.result.notes.map((n) => n.id)).toEqual(['n1']);
    // deckId карточки взят у заметки
    expect(plan.put.cards).toEqual([card('c1', 'n1', 'd1')]);
    expect(plan.stats.notes).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(plan.stats.cards).toEqual({ added: 1, updated: 0, unchanged: 0 });
  });

  it('отброшенное обновление возвращает локальную версию', () => {
    const local = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1', { updatedAt: 1 })] };
    const plan = planMerge(local, { ...empty(), notes: [note('n1', 'dX', { updatedAt: 9 })] });
    expect(plan.result.notes).toEqual([note('n1', 'd1', { updatedAt: 1 })]);
    expect(plan.put.notes).toEqual([]);
    expect(plan.dropped.notes).toBe(1);
  });

  it('два «apple» с разными id — оба остаются, предупреждение о дубликате', () => {
    const local = { ...empty(), decks: [deck('d1')], notes: [note('n1', 'd1', { front: 'apple' })] };
    const plan = planMerge(local, { ...empty(), notes: [note('n2', 'd1', { front: ' Apple ' })] });
    expect(plan.result.notes).toHaveLength(2);
    expect(plan.possibleDuplicates.notes).toBe(1);
  });

  it('одноимённые колоды с разными id', () => {
    const local = { ...empty(), decks: [deck('d1', { name: 'Еда' })] };
    const plan = planMerge(local, { ...empty(), decks: [deck('d2', { name: 'Еда' })] });
    expect(plan.result.decks).toHaveLength(2);
    expect(plan.possibleDuplicates.deckNames).toEqual(['Еда']);
  });
});

describe('settingsAfterImport', () => {
  const current: Settings = { ...DEFAULT_SETTINGS, claudeApiKey: 'sk-ant-KEY', newPerDay: 5, lastBackupAt: 100, backupReminderSnoozeUntil: 200 };
  const incoming: Settings = { ...DEFAULT_SETTINGS, newPerDay: 15, theme: 'dark' };

  it('merge — текущие без изменений', () => {
    expect(settingsAfterImport(current, incoming, 'merge')).toEqual(current);
  });

  it('replace — из файла, ключ и поля устройства сохраняются', () => {
    const s = settingsAfterImport(current, incoming, 'replace');
    expect(s.newPerDay).toBe(15);
    expect(s.theme).toBe('dark');
    expect(s.claudeApiKey).toBe('sk-ant-KEY');
    expect(s.lastBackupAt).toBe(100);
    expect(s.backupReminderSnoozeUntil).toBe(200);
  });

  it('replace без настроек в файле — текущие', () => {
    expect(settingsAfterImport(current, null, 'replace')).toEqual(current);
  });

  it('replace без ключа на устройстве — ключа нет', () => {
    const s = settingsAfterImport(DEFAULT_SETTINGS, incoming, 'replace');
    expect(s).not.toHaveProperty('claudeApiKey');
  });

  it('merge с applySettings: false — текущие без изменений', () => {
    expect(settingsAfterImport(current, incoming, 'merge', { applySettings: false })).toEqual(current);
  });

  it('merge с applySettings — как replace: из файла, ключ и поля устройства сохраняются', () => {
    const s = settingsAfterImport(current, incoming, 'merge', { applySettings: true });
    expect(s).toEqual(settingsAfterImport(current, incoming, 'replace'));
    expect(s.newPerDay).toBe(15);
    expect(s.theme).toBe('dark');
    expect(s.claudeApiKey).toBe('sk-ant-KEY');
    expect(s.lastBackupAt).toBe(100);
    expect(s.backupReminderSnoozeUntil).toBe(200);
  });

  it('merge с applySettings, но без настроек в файле — текущие', () => {
    expect(settingsAfterImport(current, null, 'merge', { applySettings: true })).toEqual(current);
  });
});
