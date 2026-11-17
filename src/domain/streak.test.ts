import { describe, expect, it } from 'vitest';
import {
  FALLBACK_ANSWER_MS,
  MAX_ANSWER_MS,
  aggregateDays,
  answerMs,
  bestStreak,
  computeStreak,
  dayIndex,
  dayIndexToStart,
  goalFromSettings,
  goalProgress,
  heatmap,
  weekday,
  type DailyGoal,
  type DayStat,
} from './streak';
import { withDefaults } from './settings';
import { DEFAULT_SETTINGS } from './types';

const MIN = 60_000;
/** Фиксированное «сейчас»: 15 января 2026 (четверг), 12:00 по локальному времени. */
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const H = 4;
const T = dayIndex(NOW, H);
const GOAL: DailyGoal = { minutes: 5, cards: 20, mode: 'any' };
const DONE: DayStat = { cards: 20, ms: 0 };

/** Дни с выполненной целью по смещениям от сегодня (1 — вчера). */
function doneDays(...offsets: number[]): Map<number, DayStat> {
  return new Map(offsets.map((o) => [T - o, { ...DONE }]));
}

/** Смещения from..to включительно. */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

describe('dayIndex: граница учебного дня', () => {
  it('03:59 — ещё вчера, 04:00 — уже сегодня', () => {
    expect(dayIndex(new Date(2026, 0, 15, 3, 59).getTime(), H)).toBe(T - 1);
    expect(dayIndex(new Date(2026, 0, 15, 4, 0).getTime(), H)).toBe(T);
  });

  it('now=03:30 — «сегодня» это вчерашний учебный день', () => {
    const now = new Date(2026, 0, 15, 3, 30).getTime();
    expect(dayIndex(now, H)).toBe(dayIndex(new Date(2026, 0, 14, 12).getTime(), H));
  });

  it('dayStartsAtHour=0 — граница в полночь', () => {
    expect(dayIndex(new Date(2026, 0, 14, 23, 59).getTime(), 0)).toBe(T - 1);
    expect(dayIndex(new Date(2026, 0, 15, 0, 0).getTime(), 0)).toBe(T);
  });

  it('dayIndexToStart — начало дня в dayStartsAtHour', () => {
    expect(dayIndexToStart(T, H)).toBe(new Date(2026, 0, 15, 4).getTime());
    expect(dayIndexToStart(T + 17, 0)).toBe(new Date(2026, 1, 1, 0).getTime());
  });

  it('weekday: 15.01.2026 — четверг', () => {
    expect(weekday(T)).toBe(3);
  });

  it('aggregateDays раскладывает по учебным дням и считает время', () => {
    const days = aggregateDays(
      [
        { reviewedAt: new Date(2026, 0, 15, 3, 59).getTime(), elapsedMs: 1000 },
        { reviewedAt: new Date(2026, 0, 15, 4, 0).getTime(), elapsedMs: 10 * MIN },
        { reviewedAt: new Date(2026, 0, 15, 23, 0).getTime() },
      ],
      H,
    );
    expect(days.get(T - 1)).toEqual({ cards: 1, ms: 1000 });
    expect(days.get(T)).toEqual({ cards: 2, ms: MAX_ANSWER_MS + FALLBACK_ANSWER_MS });
  });
});

describe('answerMs', () => {
  it('10 минут → 60 с, нет значения → 8 с, отрицательное → 0', () => {
    expect(answerMs({ elapsedMs: 10 * MIN })).toBe(60_000);
    expect(answerMs({})).toBe(8_000);
    expect(answerMs({ elapsedMs: -5 })).toBe(0);
    expect(answerMs({ elapsedMs: 4321 })).toBe(4321);
    expect(answerMs({ elapsedMs: NaN })).toBe(FALLBACK_ANSWER_MS);
  });
});

describe('цель', () => {
  it('по умолчанию 5 мин или 20 ответов', () => {
    expect(goalFromSettings(DEFAULT_SETTINGS)).toEqual({ minutes: 5, cards: 20, mode: 'any' });
  });

  it('оба порога 0 — цели нет', () => {
    expect(goalFromSettings({ ...DEFAULT_SETTINGS, goalMinutes: 0, goalCards: 0 })).toBeNull();
    expect(goalFromSettings({ ...DEFAULT_SETTINGS, goalMinutes: 0 })).toEqual({ minutes: 0, cards: 20, mode: 'any' });
  });

  it('any — хватает одного порога, all — нужны оба', () => {
    const stat: DayStat = { cards: 10, ms: 5 * MIN };
    const any = goalProgress(stat, GOAL);
    expect(any).toEqual({ ratio: 1, done: true, cards: 10, minutes: 5 });
    const all = goalProgress(stat, { ...GOAL, mode: 'all' });
    expect(all.ratio).toBe(0.5);
    expect(all.done).toBe(false);
  });

  it('выключенный порог (0) не учитывается', () => {
    const g: DailyGoal = { minutes: 0, cards: 20, mode: 'all' };
    expect(goalProgress({ cards: 20, ms: 0 }, g).done).toBe(true);
    expect(goalProgress({ cards: 19, ms: 60 * MIN }, g).done).toBe(false);
  });

  it('нет данных за день — 0', () => {
    expect(goalProgress(undefined, GOAL)).toEqual({ ratio: 0, done: false, cards: 0, minutes: 0 });
  });

  it('withDefaults: нецелые/отрицательные → по умолчанию, большие → максимум, чужой режим → any', () => {
    const s = withDefaults({ goalMinutes: 1.5, goalCards: -1, goalMode: 'x' as never });
    expect(s.goalMinutes).toBe(5);
    expect(s.goalCards).toBe(20);
    expect(s.goalMode).toBe('any');
    const big = withDefaults({ goalMinutes: 1000, goalCards: 9999, goalMode: 'all' });
    expect(big.goalMinutes).toBe(120);
    expect(big.goalCards).toBe(500);
    expect(big.goalMode).toBe('all');
    expect(withDefaults({ goalMinutes: 0, goalCards: 0 })).toMatchObject({ goalMinutes: 0, goalCards: 0 });
  });
});

describe('computeStreak', () => {
  it('пустые логи', () => {
    const s = computeStreak(new Map(), GOAL, T);
    expect(s).toMatchObject({ current: 0, todayDone: false, atRisk: false, frozenDays: [], freezeAvailable: true });
    expect(bestStreak(new Map(), GOAL)).toBe(0);
    expect(bestStreak(new Map(), GOAL, T)).toBe(0);
  });

  it('3 дня подряд, сегодня ещё нет — серия 3, под угрозой', () => {
    const s = computeStreak(doneDays(1, 2, 3), GOAL, T);
    expect(s).toMatchObject({ current: 3, todayDone: false, atRisk: true });
  });

  it('сегодня выполнено — 4', () => {
    const s = computeStreak(doneDays(0, 1, 2, 3), GOAL, T);
    expect(s).toMatchObject({ current: 4, todayDone: true, atRisk: false });
  });

  it('только сегодня — 1', () => {
    expect(computeStreak(doneDays(0), GOAL, T).current).toBe(1);
  });

  it('частично выполненный день — это пропуск', () => {
    const days = doneDays(1, 2, 5);
    days.set(T - 3, { cards: 5, ms: MIN });
    days.set(T - 4, { cards: 19, ms: 4 * MIN });
    expect(computeStreak(days, GOAL, T).current).toBe(2);
    // одиночный частичный день прощается, но не засчитывается
    days.set(T - 4, { ...DONE });
    expect(computeStreak(days, GOAL, T)).toMatchObject({ current: 4, frozenDays: [T - 3] });
  });

  it('один пропуск прощается, но в серию не считается', () => {
    const s = computeStreak(doneDays(1, 2, 4, 5), GOAL, T);
    expect(s.current).toBe(4);
    expect(s.frozenDays).toEqual([T - 3]);
    expect(s.freezeAvailable).toBe(false);
  });

  it('два пропуска подряд рвут серию', () => {
    const s = computeStreak(doneDays(1, 4, 5), GOAL, T);
    expect(s.current).toBe(1);
    expect(s.frozenDays).toEqual([]);
  });

  it('два одиночных пропуска в пределах 7 дней — второй (более ранний) рвёт', () => {
    // пропуски: -3 и -6
    const s = computeStreak(doneDays(1, 2, 4, 5, 7, 8, 9), GOAL, T);
    expect(s.current).toBe(4);
    expect(s.frozenDays).toEqual([T - 3]);
  });

  it('пропуски с интервалом больше 7 дней — оба прощаются', () => {
    const offsets = range(1, 15).filter((o) => o !== 3 && o !== 11);
    const s = computeStreak(doneDays(...offsets), GOAL, T);
    expect(s.current).toBe(13);
    expect(s.frozenDays).toEqual([T - 3, T - 11]);
    // самый свежий прощённый — 3 дня назад, сегодня пропуск простить нельзя
    expect(s.freezeAvailable).toBe(false);
  });

  it('пропуск вчера при невыполненном сегодня — серия жива', () => {
    const s = computeStreak(doneDays(2, 3, 4), GOAL, T);
    expect(s).toMatchObject({ current: 3, atRisk: true, frozenDays: [T - 1] });
  });

  it('серия считается с первого дня истории', () => {
    expect(computeStreak(doneDays(...range(1, 30)), GOAL, T).current).toBe(30);
  });

  it('start — первый день серии', () => {
    expect(computeStreak(doneDays(1, 2, 4, 5), GOAL, T).start).toBe(T - 5);
    expect(computeStreak(new Map(), GOAL, T).start).toBe(T);
  });

  it('смена цели пересчитывает серию', () => {
    const days = new Map<number, DayStat>(range(1, 3).map((o) => [T - o, { cards: 10, ms: 6 * MIN }]));
    expect(computeStreak(days, GOAL, T).current).toBe(3);
    expect(computeStreak(days, { ...GOAL, mode: 'all' }, T).current).toBe(0);
  });
});

describe('bestStreak', () => {
  it('рекорд — самая длинная серия в истории', () => {
    const days = doneDays(...range(1, 3), ...range(21, 30));
    expect(computeStreak(days, GOAL, T).current).toBe(3);
    expect(bestStreak(days, GOAL, T)).toBe(10);
    expect(bestStreak(days, GOAL)).toBe(10);
  });

  it('рекорд не меньше текущей серии', () => {
    const days = doneDays(...range(0, 5));
    expect(bestStreak(days, GOAL, T)).toBe(6);
  });

  it('прощённый пропуск не рвёт рекорд, два подряд — рвут', () => {
    expect(bestStreak(doneDays(20, 21, 23, 24), GOAL, T)).toBe(4);
    expect(bestStreak(doneDays(20, 21, 24, 25), GOAL, T)).toBe(2);
  });

  it('рекорд не уменьшается от нового пропуска рядом со старым прощённым', () => {
    // пропуск 4 дня назад прощён, серия 9 дней; сегодня пропуск — завтра рекорд всё ещё 9
    const days = doneDays(...range(1, 10).filter((o) => o !== 4));
    expect(bestStreak(days, GOAL, T)).toBe(9);
    expect(bestStreak(days, GOAL, T + 2)).toBe(9);
  });
});

describe('heatmap', () => {
  it('8 недель по 7 дней с понедельника, будущее помечено', () => {
    const cells = heatmap(doneDays(0, 1, 3), GOAL, T);
    expect(cells).toHaveLength(56);
    expect(weekday(cells[0]!.day)).toBe(0);
    const last = cells[cells.length - 1]!;
    expect(weekday(last.day)).toBe(6);
    expect(cells.find((c) => c.day === T)).toMatchObject({ done: true, future: false, level: 3, cards: 20 });
    // 15.01 — четверг: пятница–воскресенье в будущем
    expect(cells.filter((c) => c.future)).toHaveLength(3);
  });

  it('прощённый пропуск помечен, уровни по доле цели', () => {
    const days = doneDays(1, 3);
    days.set(T, { cards: 5, ms: 0 }); // 25% цели
    days.set(T - 10, { cards: 15, ms: 0 }); // 75%
    days.set(T - 11, { cards: 60, ms: 0 }); // 300%
    const cells = new Map(heatmap(days, GOAL, T).map((c) => [c.day, c]));
    expect(cells.get(T - 2)).toMatchObject({ frozen: true, done: false, level: 0 });
    expect(cells.get(T)?.level).toBe(1);
    expect(cells.get(T - 10)?.level).toBe(2);
    expect(cells.get(T - 11)?.level).toBe(4);
    expect(cells.get(T - 5)).toMatchObject({ frozen: false, level: 0 });
  });

  it('одна неделя — текущая', () => {
    const cells = heatmap(new Map(), GOAL, T, 1);
    expect(cells.map((c) => c.day)).toEqual(range(-3, 3).map((o) => T + o));
  });
});
