// fake-indexeddb должен подключиться до создания Dexie в schema.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { loadAllDays, loadStreakData, STREAK_WINDOW_DAYS } from './streak';
import { withDefaults } from './repo';
import { computeStreak, dayIndex } from '../domain/streak';
import type { ReviewLog } from '../domain/types';

const NOW = new Date(2026, 0, 15, 12).getTime();
/** Цель — 1 ответ в день. */
const SETTINGS = withDefaults({ goalCards: 1, goalMinutes: 0 });
const T = dayIndex(NOW, SETTINGS.dayStartsAtHour);

/** Ответ в 10:00 за daysAgo дней до NOW. */
function log(daysAgo: number): ReviewLog {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(10);
  return {
    id: `l${daysAgo}`,
    cardId: 'c1',
    deckId: 'd1',
    rating: 3,
    mode: 'flash',
    stateBefore: 2,
    reviewedAt: d.getTime(),
    elapsedMs: 5000,
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

beforeEach(async () => {
  await Promise.all([db.reviewLogs.clear(), db.settings.clear()]);
});

describe('loadStreakData', () => {
  it('читает только окно 8 недель, если серия в него укладывается', async () => {
    await db.reviewLogs.bulkAdd([...range(0, 3).map(log), log(STREAK_WINDOW_DAYS + 30)]);
    const data = await loadStreakData(NOW, SETTINGS);
    expect(data.today).toBe(T);
    expect([...data.days.keys()].sort((a, b) => a - b)).toEqual([T - 3, T - 2, T - 1, T]);
    expect(data.goal).toEqual({ minutes: 0, cards: 1, mode: 'any' });
    expect(computeStreak(data.days, data.goal!, data.today).current).toBe(4);
  });

  it('ответы после конца сегодняшнего дня не читаются', async () => {
    await db.reviewLogs.bulkAdd([log(0), log(-1)]);
    const data = await loadStreakData(NOW, SETTINGS);
    expect([...data.days.keys()]).toEqual([T]);
  });

  it('длинная серия — дочитывает назад, пока не оборвётся', async () => {
    await db.reviewLogs.bulkAdd([...range(1, 200).map(log), log(250)]);
    const data = await loadStreakData(NOW, SETTINGS);
    const s = computeStreak(data.days, data.goal!, data.today);
    expect(s.current).toBe(200);
    expect(data.days.size).toBeGreaterThanOrEqual(200);
    // 250 дней назад — за обрывом, дочитали блоками по 90 дней (56 + 90 + 90 = 236)
    expect(data.days.has(T - 250)).toBe(false);
  });

  it('серия ровно до начала истории — останавливается на первом ответе', async () => {
    await db.reviewLogs.bulkAdd(range(1, 100).map(log));
    const data = await loadStreakData(NOW, SETTINGS);
    expect(computeStreak(data.days, data.goal!, data.today).current).toBe(100);
  });

  it('цель выключена — без дочитывания', async () => {
    await db.reviewLogs.bulkAdd(range(1, 100).map(log));
    const data = await loadStreakData(NOW, withDefaults({ goalCards: 0, goalMinutes: 0 }));
    expect(data.goal).toBeNull();
    expect(data.days.size).toBe(STREAK_WINDOW_DAYS);
  });
});

describe('loadAllDays', () => {
  it('все дни за всю историю', async () => {
    const second = { ...log(0), reviewedAt: log(0).reviewedAt + 1 };
    await db.reviewLogs.bulkAdd([log(0), second, log(5), log(400)].map((l, i) => ({ ...l, id: `x${i}` })));
    const days = await loadAllDays(SETTINGS);
    expect(days.size).toBe(3);
    expect(days.get(T)?.cards).toBe(2);
    expect(days.has(T - 400)).toBe(true);
  });
});
