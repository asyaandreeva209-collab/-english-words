// Переходы на летнее/зимнее время: часовой пояс задаём до первого использования Date.
process.env.TZ = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { aggregateDays, bestStreak, computeStreak, dayIndex, dayIndexToStart, type DailyGoal } from './streak';

const H = 4;
const HOUR = 3_600_000;
const GOAL: DailyGoal = { minutes: 0, cards: 1, mode: 'any' };
/** Часовой пояс применился, если смещение зимой и летом разное. */
const tzApplied = new Date(2026, 0, 1).getTimezoneOffset() !== new Date(2026, 6, 1).getTimezoneOffset();

/** Один ответ в 10:00 каждый день с from по to (локальные даты, включительно). */
function dailyLogs(from: Date, to: Date): { reviewedAt: number }[] {
  const out: { reviewedAt: number }[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 10);
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59).getTime();
  while (d.getTime() <= end) {
    out.push({ reviewedAt: d.getTime() });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe.skipIf(!tzApplied)('серия и переход времени (Europe/Berlin)', () => {
  for (const [name, from, to] of [
    ['весна, 29.03.2026', new Date(2026, 2, 20), new Date(2026, 3, 5)],
    ['осень, 25.10.2026', new Date(2026, 9, 16), new Date(2026, 10, 1)],
  ] as const) {
    it(`${name}: серия не рвётся и не удваивается`, () => {
      const logs = dailyLogs(from, to);
      expect(logs).toHaveLength(17);
      const days = aggregateDays(logs, H);
      expect(days.size).toBe(17);
      const today = dayIndex(new Date(to.getFullYear(), to.getMonth(), to.getDate(), 12).getTime(), H);
      expect(computeStreak(days, GOAL, today).current).toBe(17);
      expect(bestStreak(days, GOAL, today)).toBe(17);
    });

    it(`${name}: dayIndex сплошной, начало дня всегда в 04:00`, () => {
      const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12).getTime();
      let prev = dayIndex(start, H);
      const seen = [prev];
      for (let t = start; t <= to.getTime(); t += HOUR) {
        const idx = dayIndex(t, H);
        expect(idx - prev === 0 || idx - prev === 1).toBe(true);
        if (idx !== prev) seen.push(idx);
        prev = idx;
      }
      expect(seen).toEqual(seen.map((_, i) => seen[0]! + i));
      for (const idx of seen) {
        const s = new Date(dayIndexToStart(idx, H));
        expect(s.getHours()).toBe(4);
        expect(s.getMinutes()).toBe(0);
        expect(dayIndex(s.getTime(), H)).toBe(idx);
        expect(dayIndex(s.getTime() - 1, H)).toBe(idx - 1);
      }
    });
  }

  it('сутки перехода — 23 и 25 часов', () => {
    const spring = dayIndex(new Date(2026, 2, 28, 12).getTime(), H);
    expect(dayIndexToStart(spring + 1, H) - dayIndexToStart(spring, H)).toBe(23 * HOUR);
    const autumn = dayIndex(new Date(2026, 9, 24, 12).getTime(), H);
    expect(dayIndexToStart(autumn + 1, H) - dayIndexToStart(autumn, H)).toBe(25 * HOUR);
  });
});
