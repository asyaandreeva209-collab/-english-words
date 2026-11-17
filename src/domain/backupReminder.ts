// Напоминание о резервной копии: данные живут только в этом браузере.

export const BACKUP_REMIND_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Слов без единой копии, после которых начинаем напоминать. */
const FIRST_BACKUP_NOTES = 20;

export function shouldRemindBackup(a: { noteCount: number; lastBackupAt?: number; snoozeUntil?: number; now: number }): boolean {
  if (a.noteCount === 0) return false;
  if (a.snoozeUntil !== undefined && a.now < a.snoozeUntil) return false;
  if (a.lastBackupAt === undefined) return a.noteCount >= FIRST_BACKUP_NOTES;
  return a.now - a.lastBackupAt >= BACKUP_REMIND_DAYS * DAY_MS;
}
