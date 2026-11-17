// Чтение журнала ответов для серии дней (сама логика — domain/streak.ts).
import { db } from './schema';
import { nextDayStart } from '../domain/queue';
import {
  addToDays,
  computeStreak,
  dayIndex,
  dayIndexToStart,
  goalFromSettings,
  type DailyGoal,
  type DayStat,
} from '../domain/streak';
import type { Settings } from '../domain/types';

/** Сколько дней читать сразу (календарь на 8 недель). */
export const STREAK_WINDOW_DAYS = 8 * 7;
/** Шаг дочитывания назад, если серия длиннее окна. */
export const STREAK_EXTEND_DAYS = 90;

export interface StreakData {
  days: Map<number, DayStat>;
  today: number;
  /** null — цель выключена. */
  goal: DailyGoal | null;
}

async function readRange(days: Map<number, DayStat>, from: number, to: number, h: number): Promise<void> {
  await db.reviewLogs
    .where('reviewedAt')
    .between(from, to, true, false)
    .each((l) => addToDays(days, l, h));
}

/**
 * Дни за последние 8 недель (по сегодняшний включительно). Если текущая серия упирается
 * в начало окна — дочитываем назад блоками по 90 дней, пока она не оборвётся.
 */
export async function loadStreakData(now: number, settings: Settings): Promise<StreakData> {
  const h = settings.dayStartsAtHour;
  const goal = goalFromSettings(settings);
  const today = dayIndex(now, h);
  const days = new Map<number, DayStat>();
  let fromDay = today - STREAK_WINDOW_DAYS;
  await readRange(days, dayIndexToStart(fromDay, h), nextDayStart(now, h), h);
  if (!goal) return { days, today, goal };

  const earliest = await db.reviewLogs.orderBy('reviewedAt').first();
  if (!earliest) return { days, today, goal };
  const earliestDay = dayIndex(earliest.reviewedAt, h);
  // Для проверки дня-обрыва нужен и день перед ним, поэтому запас в 2 дня
  while (fromDay > earliestDay && computeStreak(days, goal, today).start - 2 < fromDay) {
    const prev = fromDay - STREAK_EXTEND_DAYS;
    await readRange(days, dayIndexToStart(prev, h), dayIndexToStart(fromDay, h), h);
    fromDay = prev;
  }
  return { days, today, goal };
}

/** Все дни за всю историю (для рекорда в статистике). */
export async function loadAllDays(settings: Settings): Promise<Map<number, DayStat>> {
  const days = new Map<number, DayStat>();
  await db.reviewLogs.orderBy('reviewedAt').each((l) => addToDays(days, l, settings.dayStartsAtHour));
  return days;
}
