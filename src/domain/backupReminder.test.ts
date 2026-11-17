import { describe, expect, it } from 'vitest';
import { BACKUP_REMIND_DAYS, shouldRemindBackup } from './backupReminder';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 0, 15, 12).getTime();

describe('shouldRemindBackup', () => {
  it('нет слов — не напоминаем', () => {
    expect(shouldRemindBackup({ noteCount: 0, now: NOW })).toBe(false);
    expect(shouldRemindBackup({ noteCount: 0, lastBackupAt: NOW - 100 * DAY, now: NOW })).toBe(false);
  });

  it('копии не было: с 20 слов', () => {
    expect(shouldRemindBackup({ noteCount: 19, now: NOW })).toBe(false);
    expect(shouldRemindBackup({ noteCount: 20, now: NOW })).toBe(true);
  });

  it('копия была: ровно 7 суток — напоминаем, чуть меньше — нет', () => {
    expect(BACKUP_REMIND_DAYS).toBe(7);
    expect(shouldRemindBackup({ noteCount: 1, lastBackupAt: NOW - 7 * DAY, now: NOW })).toBe(true);
    expect(shouldRemindBackup({ noteCount: 1, lastBackupAt: NOW - 7 * DAY + 1, now: NOW })).toBe(false);
  });

  it('отсрочка', () => {
    expect(shouldRemindBackup({ noteCount: 50, snoozeUntil: NOW + 1, now: NOW })).toBe(false);
    expect(shouldRemindBackup({ noteCount: 50, snoozeUntil: NOW, now: NOW })).toBe(true);
  });
});
