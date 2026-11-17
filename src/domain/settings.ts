// Настройки: значения по умолчанию и что остаётся после импорта резервной копии.
import type { BackupSettings } from './backup';
import type { ImportMode } from './backupImport';
import { DEFAULT_SETTINGS, ENGLISH_LEVELS, isClaudeModel, type Settings } from './types';

export function withDefaults(s: Partial<Settings> | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, ...s, id: 'main' };
  if (!isClaudeModel(out.claudeModel)) out.claudeModel = DEFAULT_SETTINGS.claudeModel;
  if (!ENGLISH_LEVELS.includes(out.englishLevel)) out.englishLevel = DEFAULT_SETTINGS.englishLevel;
  out.goalMinutes = goalValue(out.goalMinutes, DEFAULT_SETTINGS.goalMinutes, MAX_GOAL_MINUTES);
  out.goalCards = goalValue(out.goalCards, DEFAULT_SETTINGS.goalCards, MAX_GOAL_CARDS);
  if (out.goalMode !== 'any' && out.goalMode !== 'all') out.goalMode = DEFAULT_SETTINGS.goalMode;
  return out;
}

export const MAX_GOAL_MINUTES = 120;
export const MAX_GOAL_CARDS = 500;

/** Порог цели: нецелое/отрицательное — значение по умолчанию, слишком большое — максимум. */
function goalValue(v: unknown, fallback: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return fallback;
  return Math.min(v, max);
}

export interface SettingsImportOptions {
  /** Для merge: перенести настройки из файла (как при replace). При replace не влияет. */
  applySettings: boolean;
}

/**
 * Настройки после импорта. merge — текущие без изменений (или из файла, если applySettings);
 * replace — из файла, но ключ API и данные о резервных копиях остаются с этого устройства.
 */
export function settingsAfterImport(
  current: Settings,
  incoming: BackupSettings | null,
  mode: ImportMode,
  opts: SettingsImportOptions = { applySettings: false },
): Settings {
  if ((mode === 'merge' && !opts.applySettings) || incoming === null) return current;
  const out = withDefaults(incoming);
  // Поля устройства: из файла их не берём никогда
  delete out.claudeApiKey;
  delete out.lastBackupAt;
  delete out.backupReminderSnoozeUntil;
  if (current.claudeApiKey !== undefined) out.claudeApiKey = current.claudeApiKey;
  if (current.lastBackupAt !== undefined) out.lastBackupAt = current.lastBackupAt;
  if (current.backupReminderSnoozeUntil !== undefined) out.backupReminderSnoozeUntil = current.backupReminderSnoozeUntil;
  return out;
}
