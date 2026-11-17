import { describe, expect, it } from 'vitest';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, backupFileName, buildBackup, toBackupSettings } from './backup';
import { DEFAULT_SETTINGS, type Deck } from './types';

const deck: Deck = { id: 'd1', name: 'D', kind: 'vocab', createdAt: 1, updatedAt: 1 };

describe('buildBackup', () => {
  it('версия формата — 2', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(2);
    expect(buildBackup({ decks: [], notes: [], cards: [], reviewLogs: [] }, 0).schemaVersion).toBe(2);
  });

  it('содержит заголовок и данные', () => {
    const b = buildBackup({ decks: [deck], notes: [], cards: [], reviewLogs: [] }, 123);
    expect(b).toEqual({
      app: BACKUP_APP,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 123,
      decks: [deck],
      notes: [],
      cards: [],
      reviewLogs: [],
      settings: null,
    });
  });

  it('не содержит claudeApiKey, остальные настройки сохраняются', () => {
    const settings = { ...DEFAULT_SETTINGS, claudeApiKey: 'sk-ant-SECRET', newPerDay: 7 };
    const b = buildBackup({ decks: [], notes: [], cards: [], reviewLogs: [], settings }, 0);
    expect(b.settings).not.toHaveProperty('claudeApiKey');
    expect(b.settings?.newPerDay).toBe(7);
    expect(JSON.stringify(b)).not.toContain('sk-ant-SECRET');
    // исходный объект настроек не изменён
    expect(settings.claudeApiKey).toBe('sk-ant-SECRET');
  });

  it('не выгружает поля устройства (lastBackupAt, backupReminderSnoozeUntil)', () => {
    const settings = { ...DEFAULT_SETTINGS, lastBackupAt: 111, backupReminderSnoozeUntil: 222 };
    const b = buildBackup({ decks: [], notes: [], cards: [], reviewLogs: [], settings }, 0);
    expect(b.settings).toEqual(DEFAULT_SETTINGS);
    expect(b.settings).not.toHaveProperty('lastBackupAt');
    expect(b.settings).not.toHaveProperty('backupReminderSnoozeUntil');
  });

  it('toBackupSettings сохраняет дневную цель', () => {
    const settings = { ...DEFAULT_SETTINGS, goalMinutes: 0, goalCards: 50, goalMode: 'all' as const };
    expect(toBackupSettings(settings)).toMatchObject({ goalMinutes: 0, goalCards: 50, goalMode: 'all' });
  });

  it('без ключа в настройках тоже работает', () => {
    const b = buildBackup({ decks: [], notes: [], cards: [], reviewLogs: [], settings: DEFAULT_SETTINGS }, 0);
    expect(b.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('backupFileName', () => {
  it('формат с датой и ведущими нулями', () => {
    expect(backupFileName(new Date(2026, 0, 5, 12).getTime())).toBe('english-words-2026-01-05.json');
  });
});
