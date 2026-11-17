// fake-indexeddb должен подключиться до создания Dexie в schema.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { addNotes, createDeck, exportAll, getSettings, recordReview, saveSettings, updateNote } from './repo';
import { applyImport, previewImport, readSnapshot } from './importBackup';
import { BACKUP_APP } from '../domain/backup';
import { parseBackupJson, type Snapshot } from '../domain/backupImport';
import { loadQueue } from '../features/study/loadQueue';
import { CardStates, type Card } from '../domain/types';

const NOW = new Date(2026, 0, 15, 12).getTime();
const MIN = 60_000;
const DAY = 86_400_000;
const NO_FUZZ = { enableFuzz: false };

const clearAll = () =>
  Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);

beforeEach(clearAll);

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const sorted = (s: Snapshot): Snapshot => ({
  decks: byId(s.decks),
  notes: byId(s.notes),
  cards: byId(s.cards),
  reviewLogs: byId(s.reviewLogs),
});

/** Колода с двумя словами (fwd+rev), несколько ответов, одно слово отредактировано. */
async function seed(): Promise<Snapshot> {
  const deck = await createDeck({ name: 'Еда', kind: 'vocab' }, NOW);
  const grammar = await createDeck({ name: 'Времена', kind: 'grammar' }, NOW);
  const [apple] = await addNotes(deck.id, [{ front: 'apple', back: 'яблоко' }, { front: 'pear', back: 'груша', comment: 'c' }], {
    createReverse: true,
    now: NOW,
  });
  await addNotes(grammar.id, [{ front: 'Present Simple?', back: '**V1**' }], { createReverse: true, now: NOW });
  await updateNote(apple!.id, { front: 'apple', back: 'яблоко, яблочко' }, NOW + 5);
  const cards = await db.cards.orderBy('id').toArray();
  let c = cards[0]!;
  c = (await recordReview(c, 3, { mode: 'flash', now: NOW + 1000, elapsedMs: 1500, scheduler: NO_FUZZ })).card;
  c = (await recordReview(c, 3, { mode: 'type', now: NOW + 11 * MIN, scheduler: NO_FUZZ })).card;
  await recordReview(cards[1]!, 1, { mode: 'choice', now: NOW + 2000, scheduler: NO_FUZZ });
  return readSnapshot();
}

const exportText = async (now = NOW + DAY) => JSON.stringify(await exportAll(now));

describe('экспорт → импорт в ту же БД (идемпотентность)', () => {
  it('merge собственного экспорта: всё «без изменений», данные идентичны', async () => {
    const before = await seed();
    await saveSettings({ claudeApiKey: 'sk-ant-KEY', newPerDay: 4, lastBackupAt: NOW });
    const settingsBefore = await getSettings();
    const parsed = parseBackupJson(await exportText());

    const plan = await applyImport(parsed, 'merge');

    expect(plan.stats).toEqual({
      decks: { added: 0, updated: 0, unchanged: before.decks.length },
      notes: { added: 0, updated: 0, unchanged: before.notes.length },
      cards: { added: 0, updated: 0, unchanged: before.cards.length },
      reviewLogs: { added: 0, updated: 0, unchanged: before.reviewLogs.length },
    });
    expect(plan.put).toEqual({ decks: [], notes: [], cards: [], reviewLogs: [] });
    expect(plan.dropped).toEqual({ notes: 0, cards: 0, reviewLogs: 0 });
    expect(plan.possibleDuplicates).toEqual({ notes: 0, deckNames: [] });
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    expect(await getSettings()).toEqual(settingsBefore);
  });

  it('повторный merge того же файла — тот же результат', async () => {
    const before = await seed();
    const text = await exportText();
    await applyImport(parseBackupJson(text), 'merge');
    const plan2 = await applyImport(parseBackupJson(text), 'merge');
    expect(plan2.put).toEqual({ decks: [], notes: [], cards: [], reviewLogs: [] });
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
  });

  it('replace собственным экспортом — данные идентичны, настройки (кроме полей устройства) из файла', async () => {
    const before = await seed();
    await saveSettings({ claudeApiKey: 'sk-ant-KEY', newPerDay: 4, lastBackupAt: 77, backupReminderSnoozeUntil: 88 });
    const settingsBefore = await getSettings();
    await applyImport(parseBackupJson(await exportText()), 'replace');
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    expect(await getSettings()).toEqual(settingsBefore);
  });

  it('merge экспорта в пустую БД = исходные данные', async () => {
    const before = await seed();
    const text = await exportText();
    await clearAll();
    const plan = await applyImport(parseBackupJson(text), 'merge');
    expect(plan.stats.cards.added).toBe(before.cards.length);
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    // при объединении настройки из файла не применяются
    expect(await db.settings.get('main')).toMatchObject({ id: 'main' });
  });

  it('предпросмотр не пишет в БД', async () => {
    const before = await seed();
    const text = JSON.stringify({ app: BACKUP_APP, schemaVersion: 2, exportedAt: 1, decks: [], notes: [], cards: [], reviewLogs: [], settings: null });
    const preview = await previewImport(parseBackupJson(text), 'replace');
    expect(preview.result).toEqual({ decks: [], notes: [], cards: [], reviewLogs: [] });
    expect(preview.localCounts.notes).toBe(before.notes.length);
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
  });
});

describe('пустой бэкап', () => {
  const emptyBackup = (settings: unknown) =>
    JSON.stringify({ app: BACKUP_APP, schemaVersion: 2, exportedAt: NOW, decks: [], notes: [], cards: [], reviewLogs: [], settings });

  it('merge пустого файла ничего не меняет', async () => {
    const before = await seed();
    await saveSettings({ newPerDay: 3 });
    const plan = await applyImport(parseBackupJson(emptyBackup({ newPerDay: 50 })), 'merge');
    expect(plan.stats.notes).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    expect((await getSettings()).newPerDay).toBe(3);
  });

  it('replace пустым файлом с settings: null — данные стёрты, настройки и ключ остались', async () => {
    await seed();
    await saveSettings({ claudeApiKey: 'sk-ant-KEY', newPerDay: 3, lastBackupAt: 5, backupReminderSnoozeUntil: 6 });
    const settingsBefore = await getSettings();
    await applyImport(parseBackupJson(emptyBackup(null)), 'replace');
    expect(await readSnapshot()).toEqual({ decks: [], notes: [], cards: [], reviewLogs: [] });
    expect(await getSettings()).toEqual(settingsBefore);
  });

  it('replace в БД без настроек: запись настроек появляется со значениями по умолчанию', async () => {
    await applyImport(parseBackupJson(emptyBackup(null)), 'replace');
    const s = await db.settings.get('main');
    expect(s?.newPerDay).toBe(10);
    expect(s).not.toHaveProperty('claudeApiKey');
  });

  it('replace без ключа на устройстве: ключ из файла не появляется', async () => {
    await applyImport(parseBackupJson(emptyBackup({ claudeApiKey: 'sk-ant-FILE', newPerDay: 9 })), 'replace');
    const s = await getSettings();
    expect(s.newPerDay).toBe(9);
    expect(s.claudeApiKey).toBeUndefined();
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('sk-ant-FILE');
  });
});

describe('карточки FSRS после импорта рабочие', () => {
  it('replace → recordReview по импортированной карточке и очередь строится', async () => {
    const before = await seed();
    const reviewed = before.cards.find((c) => c.reps === 2)!;
    expect(reviewed.state).toBe(CardStates.Review);
    expect(reviewed.last_review).toBeTypeOf('number');
    const text = await exportText();
    await clearAll();
    await applyImport(parseBackupJson(text), 'replace');

    const imported = (await db.cards.get(reviewed.id))!;
    expect(imported).toEqual(reviewed);
    const due = imported.due;
    const res = await recordReview(imported, 3, { mode: 'flash', now: due + DAY, scheduler: NO_FUZZ });
    expect(res.card.reps).toBe(3);
    expect(res.card.due).toBeGreaterThan(due + DAY);
    expect(Number.isFinite(res.card.stability)).toBe(true);
    expect(await db.reviewLogs.count()).toBe(before.reviewLogs.length + 1);

    // ответы до импорта и после — одна и та же история; очередь на момент «через день» строится без ошибок
    const q = await loadQueue(NOW + DAY);
    expect(q.queue.length).toBeGreaterThan(0);
    for (const c of q.queue) expect(c.id).toBeTypeOf('string');
  });

  it('импортированная новая карточка (state New) отвечается и попадает в очередь как новая', async () => {
    await seed();
    const text = await exportText();
    await clearAll();
    await applyImport(parseBackupJson(text), 'merge');
    const q = await loadQueue(NOW + 2 * DAY);
    expect(q.fresh.length).toBeGreaterThan(0);
    const fresh = q.fresh[0]!;
    const res = await recordReview(fresh, 4, { mode: 'flash', now: NOW + 2 * DAY, scheduler: NO_FUZZ });
    expect(res.card.state).not.toBe(CardStates.New);
  });

  it('файл ровно в формате, который даёт ts-fsrs через review(), проходит zod без потерь', async () => {
    await seed();
    const exported = await exportAll(NOW);
    const parsed = parseBackupJson(JSON.stringify(exported));
    expect(byId(parsed.cards)).toEqual(byId(exported.cards));
    expect(byId(parsed.reviewLogs)).toEqual(byId(exported.reviewLogs));
  });
});

describe('merge на реальной БД: граничные случаи', () => {
  it('файл обновляет заметку, а его копия колоды старее — колода локальная, заметка из файла', async () => {
    const before = await seed();
    const deck = before.decks.find((d) => d.name === 'Еда')!;
    await db.decks.update(deck.id, { name: 'Еда (переименована)', updatedAt: NOW + 10 * DAY });
    const n = before.notes.find((x) => x.deckId === deck.id)!;
    const text = JSON.stringify({
      app: BACKUP_APP,
      schemaVersion: 2,
      exportedAt: NOW,
      decks: [deck],
      notes: [{ ...n, back: 'из файла', updatedAt: NOW + 20 * DAY }],
      cards: [],
      reviewLogs: [],
      settings: null,
    });
    const plan = await applyImport(parseBackupJson(text), 'merge');
    expect(plan.stats.decks).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(plan.stats.notes).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect((await db.decks.get(deck.id))?.name).toBe('Еда (переименована)');
    expect((await db.notes.get(n.id))?.back).toBe('из файла');
  });

  it('карточка из файла для заметки, которая есть только локально — записывается с deckId заметки', async () => {
    const before = await seed();
    const n = before.notes[0]!;
    const src = before.cards[0]!;
    const extra: Card = { ...src, id: 'card-from-file', noteId: n.id, deckId: 'чужая-колода', direction: 'rev' };
    const text = JSON.stringify({ app: BACKUP_APP, schemaVersion: 2, exportedAt: NOW, decks: [], notes: [], cards: [extra], reviewLogs: [], settings: null });
    const plan = await applyImport(parseBackupJson(text), 'merge');
    expect(plan.stats.cards).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect((await db.cards.get('card-from-file'))?.deckId).toBe(n.deckId);
  });

  it('отброшенное обновление (битая ссылка) не затирает локальную запись в БД', async () => {
    const before = await seed();
    const n = before.notes[0]!;
    const c = before.cards.find((x) => x.noteId === n.id)!;
    const text = JSON.stringify({
      app: BACKUP_APP,
      schemaVersion: 2,
      exportedAt: NOW,
      decks: [],
      notes: [{ ...n, deckId: 'нет-такой', back: 'ЗАТЁРТО', updatedAt: NOW + 99 * DAY }],
      cards: [{ ...c, noteId: 'нет-такой', reps: 999, updatedAt: NOW + 99 * DAY }],
      reviewLogs: [{ id: 'orphan', cardId: 'нет-такой', deckId: 'x', rating: 3, mode: 'flash', stateBefore: 0, reviewedAt: NOW }],
      settings: null,
    });
    const plan = await applyImport(parseBackupJson(text), 'merge');
    expect(plan.dropped).toEqual({ notes: 1, cards: 1, reviewLogs: 1 });
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
  });

  it('история из файла дополняет локальную, повторяющиеся id не перезаписываются', async () => {
    const before = await seed();
    const l = before.reviewLogs[0]!;
    const text = JSON.stringify({
      app: BACKUP_APP,
      schemaVersion: 2,
      exportedAt: NOW,
      decks: [],
      notes: [],
      cards: [],
      reviewLogs: [
        { ...l, rating: l.rating === 1 ? 4 : 1 },
        { ...l, id: 'new-log', reviewedAt: NOW - DAY },
      ],
      settings: null,
    });
    const plan = await applyImport(parseBackupJson(text), 'merge');
    expect(plan.stats.reviewLogs).toEqual({ added: 1, updated: 0, unchanged: 1 });
    expect(await db.reviewLogs.get(l.id)).toEqual(l);
    expect(await db.reviewLogs.get('new-log')).toBeDefined();
  });

  it('импорт v1-файла на реальной БД: лимиты в словах, карточки отвечаются', async () => {
    const v1 = {
      app: BACKUP_APP,
      schemaVersion: 1,
      exportedAt: NOW,
      decks: [{ id: 'd', name: 'Старая', kind: 'vocab', newPerDay: 9, createdAt: 1, updatedAt: 1 }],
      notes: [{ id: 'n', deckId: 'd', front: 'cat', back: 'кот', createdAt: 1, updatedAt: 1 }],
      cards: [
        { id: 'c', noteId: 'n', deckId: 'd', direction: 'fwd', due: NOW, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, updatedAt: 1 },
      ],
      reviewLogs: [],
      settings: { id: 'main', newPerDay: 20, createReverse: true, claudeModel: 'claude-sonnet-4-5', claudeApiKey: 'sk-ant-OLD' },
    };
    await saveSettings({ claudeApiKey: 'sk-ant-NEW' });
    await applyImport(parseBackupJson(JSON.stringify(v1)), 'replace');
    const s = await getSettings();
    expect(s.newPerDay).toBe(10);
    expect(s.claudeApiKey).toBe('sk-ant-NEW');
    expect((await db.decks.get('d'))?.newPerDay).toBe(5);
    const q = await loadQueue(NOW);
    expect(q.queue.map((c) => c.id)).toEqual(['c']);
    await recordReview(q.queue[0]!, 3, { mode: 'flash', now: NOW, scheduler: NO_FUZZ });
    expect((await db.cards.get('c'))?.reps).toBe(1);
  });
});

describe('атомарность: граничные случаи', () => {
  it('сбой записи настроек при merge откатывает и добавленные записи', async () => {
    const before = await seed();
    const text = JSON.stringify({
      app: BACKUP_APP,
      schemaVersion: 2,
      exportedAt: NOW,
      decks: [{ id: 'new-d', name: 'Новая', kind: 'vocab', createdAt: 1, updatedAt: 1 }],
      notes: [{ id: 'new-n', deckId: 'new-d', front: 'x', back: 'y', createdAt: 1, updatedAt: 1 }],
      cards: [],
      reviewLogs: [],
      settings: null,
    });
    const spy = vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('settings boom'));
    try {
      await expect(applyImport(parseBackupJson(text), 'merge')).rejects.toThrow('settings boom');
    } finally {
      spy.mockRestore();
    }
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
  });

  it('сбой записи истории при replace: старые данные на месте', async () => {
    const before = await seed();
    const text = JSON.stringify({ ...(await exportAll(NOW)), decks: before.decks.map((d) => ({ ...d, name: 'X' })) });
    const spy = vi.spyOn(db.reviewLogs, 'bulkPut').mockRejectedValueOnce(new Error('logs boom'));
    try {
      await expect(applyImport(parseBackupJson(text), 'replace')).rejects.toThrow('logs boom');
    } finally {
      spy.mockRestore();
    }
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
  });
});
