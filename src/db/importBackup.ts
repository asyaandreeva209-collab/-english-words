// Импорт резервной копии в БД: предпросмотр и применение одной транзакцией.
import { db } from './schema';
import { planMerge, planReplace, type ImportMode, type ImportPlan, type ParsedBackup, type Snapshot } from '../domain/backupImport';
import { settingsAfterImport, withDefaults, type SettingsImportOptions } from '../domain/settings';

async function readTables(): Promise<Snapshot> {
  const [decks, notes, cards, reviewLogs] = await Promise.all([
    db.decks.toArray(),
    db.notes.toArray(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
  ]);
  return { decks, notes, cards, reviewLogs };
}

export async function readSnapshot(): Promise<Snapshot> {
  return db.transaction('r', [db.decks, db.notes, db.cards, db.reviewLogs], readTables);
}

function plan(local: Snapshot, p: ParsedBackup, mode: ImportMode): ImportPlan {
  return mode === 'merge' ? planMerge(local, p) : planReplace(p);
}

/** hasLocalSettings — сохранены ли на устройстве настройки (иначе действуют значения по умолчанию). */
export async function previewImport(
  p: ParsedBackup,
  mode: ImportMode,
): Promise<ImportPlan & { localCounts: Record<keyof Snapshot, number>; hasLocalSettings: boolean }> {
  const [local, settings] = await db.transaction('r', [db.decks, db.notes, db.cards, db.reviewLogs, db.settings], () =>
    Promise.all([readTables(), db.settings.get('main')]),
  );
  return {
    ...plan(local, p, mode),
    localCounts: {
      decks: local.decks.length,
      notes: local.notes.length,
      cards: local.cards.length,
      reviewLogs: local.reviewLogs.length,
    },
    hasLocalSettings: settings !== undefined,
  };
}

/** Применяет импорт. Всё в одной транзакции: при любой ошибке БД остаётся как была. */
export async function applyImport(
  p: ParsedBackup,
  mode: ImportMode,
  opts: SettingsImportOptions = { applySettings: false },
): Promise<ImportPlan> {
  return db.transaction('rw', [db.decks, db.notes, db.cards, db.reviewLogs, db.settings], async () => {
    // План пересчитываем по актуальным данным: с момента предпросмотра они могли измениться
    const result = plan(await readTables(), p, mode);
    if (mode === 'replace') {
      await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear()]);
    }
    await db.decks.bulkPut(result.put.decks);
    await db.notes.bulkPut(result.put.notes);
    await db.cards.bulkPut(result.put.cards);
    await db.reviewLogs.bulkPut(result.put.reviewLogs);
    const current = withDefaults(await db.settings.get('main'));
    await db.settings.put(settingsAfterImport(current, p.settings, mode, opts));
    return result;
  });
}
