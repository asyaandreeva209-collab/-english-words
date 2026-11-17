// fake-indexeddb должен подключиться до создания Dexie в schema.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './schema';
import { addNotes, createDeck, exportAll, getSettings, recordReview, saveSettings } from './repo';
import { applyImport, previewImport, readSnapshot } from './importBackup';
import { BACKUP_APP } from '../domain/backup';
import { parseBackupJson, type Snapshot } from '../domain/backupImport';
import type { Note } from '../domain/types';

const NOW = new Date(2026, 0, 15, 12).getTime();

beforeEach(async () => {
  await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);
});

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const sorted = (s: Snapshot): Snapshot => ({
  decks: byId(s.decks),
  notes: byId(s.notes),
  cards: byId(s.cards),
  reviewLogs: byId(s.reviewLogs),
});

async function seed(): Promise<Snapshot> {
  const deck = await createDeck({ name: 'Еда', kind: 'vocab' }, NOW);
  await addNotes(deck.id, [{ front: 'apple', back: 'яблоко' }, { front: 'pear', back: 'груша', comment: 'c' }], {
    createReverse: true,
    now: NOW,
  });
  const card = (await db.cards.toArray())[0]!;
  await recordReview(card, 3, { mode: 'flash', now: NOW + 1000, elapsedMs: 1500 });
  return readSnapshot();
}

function backupText(s: Snapshot, settings: unknown = null): string {
  return JSON.stringify({ app: BACKUP_APP, schemaVersion: 2, exportedAt: NOW, ...s, settings });
}

describe('applyImport', () => {
  it('round-trip: экспорт → очистка → замена восстанавливает всё', async () => {
    await saveSettings({ newPerDay: 7 });
    const before = await seed();
    const text = JSON.stringify(await exportAll(NOW));
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);

    await applyImport(parseBackupJson(text), 'replace');

    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    expect((await getSettings()).newPerDay).toBe(7);
  });

  it('merge на реальной БД: новое добавляется, более новое заменяет, старое не трогает', async () => {
    const local = await seed();
    const [n1, n2] = local.notes as [Note, Note];
    await saveSettings({ newPerDay: 3 });
    const incoming: Snapshot = {
      decks: local.decks,
      notes: [
        { ...n1, back: 'из файла', updatedAt: n1.updatedAt + 10 },
        { ...n2, back: 'старое', updatedAt: n2.updatedAt - 10 },
        { ...n1, id: 'new-note', front: 'plum', back: 'слива' },
      ],
      cards: [],
      reviewLogs: [],
    };

    const preview = await previewImport(parseBackupJson(backupText(incoming, { newPerDay: 20 })), 'merge');
    expect(preview.stats.notes).toEqual({ added: 1, updated: 1, unchanged: 1 });
    expect(preview.localCounts.notes).toBe(2);

    const plan = await applyImport(parseBackupJson(backupText(incoming, { newPerDay: 20 })), 'merge');
    expect(plan.stats.notes).toEqual({ added: 1, updated: 1, unchanged: 1 });
    expect((await db.notes.get(n1.id))?.back).toBe('из файла');
    expect((await db.notes.get(n2.id))?.back).toBe(n2.back);
    expect(await db.notes.get('new-note')).toBeDefined();
    expect(await db.cards.count()).toBe(local.cards.length);
    expect(await db.reviewLogs.count()).toBe(1);
    // настройки при объединении не меняются
    expect((await getSettings()).newPerDay).toBe(3);
  });

  it('merge с переносом настроек: настройки из файла, ключ API и lastBackupAt с устройства', async () => {
    const local = await seed();
    await saveSettings({ claudeApiKey: 'sk-ant-KEY', lastBackupAt: 42, newPerDay: 3 });
    const text = backupText(local, { newPerDay: 20, theme: 'dark', claudeApiKey: 'sk-ant-FILE', lastBackupAt: 7 });

    await applyImport(parseBackupJson(text), 'merge', { applySettings: true });

    const s = await getSettings();
    expect(s.newPerDay).toBe(20);
    expect(s.theme).toBe('dark');
    expect(s.claudeApiKey).toBe('sk-ant-KEY');
    expect(s.lastBackupAt).toBe(42);
  });

  it('previewImport: hasLocalSettings — сохранены ли настройки на устройстве', async () => {
    const parsed = parseBackupJson(backupText({ decks: [], notes: [], cards: [], reviewLogs: [] }, { newPerDay: 20 }));
    expect((await previewImport(parsed, 'merge')).hasLocalSettings).toBe(false);
    await saveSettings({ newPerDay: 3 });
    expect((await previewImport(parsed, 'merge')).hasLocalSettings).toBe(true);
  });

  it('replace: старые записи удалены, ключ API и lastBackupAt сохранены', async () => {
    await seed();
    await saveSettings({ claudeApiKey: 'sk-ant-KEY', lastBackupAt: 42, newPerDay: 3 });
    const incoming: Snapshot = {
      decks: [{ id: 'd-new', name: 'Новая', kind: 'vocab', createdAt: 1, updatedAt: 1 }],
      notes: [{ id: 'n-new', deckId: 'd-new', front: 'x', back: 'икс', createdAt: 1, updatedAt: 1 }],
      cards: [],
      reviewLogs: [],
    };
    await applyImport(parseBackupJson(backupText(incoming, { newPerDay: 12, claudeApiKey: 'sk-ant-FILE' })), 'replace');

    const snap = await readSnapshot();
    expect(snap.decks.map((d) => d.id)).toEqual(['d-new']);
    expect(snap.notes.map((n) => n.id)).toEqual(['n-new']);
    expect(snap.cards).toEqual([]);
    expect(snap.reviewLogs).toEqual([]);
    const s = await getSettings();
    expect(s.newPerDay).toBe(12);
    expect(s.claudeApiKey).toBe('sk-ant-KEY');
    expect(s.lastBackupAt).toBe(42);
  });

  it('атомарность: сбой записи откатывает всё, включая очищенные таблицы', async () => {
    const before = await seed();
    await saveSettings({ newPerDay: 3 });
    const settingsBefore = await getSettings();
    const text = backupText({ ...before, decks: before.decks.map((d) => ({ ...d, name: 'Другое' })) }, { newPerDay: 30 });
    const spy = vi.spyOn(db.cards, 'bulkPut').mockRejectedValueOnce(new Error('boom'));
    try {
      await expect(applyImport(parseBackupJson(text), 'replace')).rejects.toThrow('boom');
    } finally {
      spy.mockRestore();
    }
    expect(sorted(await readSnapshot())).toEqual(sorted(before));
    expect(await getSettings()).toEqual(settingsBefore);
  });
});
