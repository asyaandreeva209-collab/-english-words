// Резервная копия: формат файла и экспорт. Импорт — backupImport.ts.
import type { Card, Deck, Note, ReviewLog, Settings } from './types';

export const BACKUP_APP = 'english-words';
export const BACKUP_SCHEMA_VERSION = 2;

/** Настройки в файле: без ключа API и без полей, относящихся к конкретному устройству. */
export type BackupSettings = Omit<Settings, 'claudeApiKey' | 'lastBackupAt' | 'backupReminderSnoozeUntil'>;

export interface BackupData {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  exportedAt: number;
  decks: Deck[];
  notes: Note[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: BackupSettings | null;
}

/** Настройки для файла: API-ключ и поля устройства никогда туда не попадают. */
export function toBackupSettings(s: Settings): BackupSettings {
  const { claudeApiKey: _key, lastBackupAt: _last, backupReminderSnoozeUntil: _snooze, ...rest } = s;
  void _key;
  void _last;
  void _snooze;
  return rest;
}

export function buildBackup(
  data: { decks: Deck[]; notes: Note[]; cards: Card[]; reviewLogs: ReviewLog[]; settings?: Settings },
  now: number,
): BackupData {
  const settings = data.settings ? toBackupSettings(data.settings) : null;
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    decks: data.decks,
    notes: data.notes,
    cards: data.cards,
    reviewLogs: data.reviewLogs,
    settings,
  };
}

export function backupFileName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `english-words-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}
