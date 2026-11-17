// Серия дней и дневная цель. Чистая логика: всё считается по журналу ответов, ничего не хранится.
import { dayStart } from './queue';
import type { ReviewLog, Settings } from './types';

/** Дольше этого один ответ не засчитывается (отошли от экрана). */
export const MAX_ANSWER_MS = 60_000;
/** Время ответа для старых записей без elapsedMs. */
export const FALLBACK_ANSWER_MS = 8_000;
/** Прощённый пропуск — не чаще одного на любые FREEZE_WINDOW дней подряд. */
export const FREEZE_WINDOW = 7;

const DAY_MS = 86_400_000;

export interface DailyGoal {
  /** 0 — порог выключен. */
  minutes: number;
  /** 0 — порог выключен. */
  cards: number;
  mode: 'any' | 'all';
}

export interface DayStat {
  /** Ответов за учебный день (включая повторы одной карточки). */
  cards: number;
  /** Время занятий, мс (каждый ответ — не больше MAX_ANSWER_MS). */
  ms: number;
}

/** Цель из настроек; null — оба порога выключены, цели нет. */
export function goalFromSettings(s: Settings): DailyGoal | null {
  if (s.goalMinutes <= 0 && s.goalCards <= 0) return null;
  return { minutes: Math.max(0, s.goalMinutes), cards: Math.max(0, s.goalCards), mode: s.goalMode };
}

/** Сколько засчитать за ответ: [0, MAX_ANSWER_MS], нет данных — FALLBACK_ANSWER_MS. */
export function answerMs(l: Pick<ReviewLog, 'elapsedMs'>): number {
  const ms = l.elapsedMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return FALLBACK_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(0, ms));
}

/**
 * Номер учебного дня: календарная дата его начала (локально), выраженная в сутках от 1970-01-01.
 * Номера идут подряд без пропусков и повторов — переход на летнее/зимнее время на них не влияет.
 */
export function dayIndex(t: number, dayStartsAtHour: number): number {
  const d = new Date(dayStart(t, dayStartsAtHour));
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Начало учебного дня по его номеру (локальное время, dayStartsAtHour:00). */
export function dayIndexToStart(idx: number, dayStartsAtHour: number): number {
  const u = new Date(idx * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), dayStartsAtHour).getTime();
}

/** День недели по номеру дня: 0 — понедельник … 6 — воскресенье. */
export function weekday(idx: number): number {
  // 1970-01-01 — четверг
  return (((idx + 3) % 7) + 7) % 7;
}

/** Ответы и время по учебным дням. */
export function aggregateDays(
  logs: Iterable<Pick<ReviewLog, 'reviewedAt' | 'elapsedMs'>>,
  dayStartsAtHour: number,
): Map<number, DayStat> {
  const out = new Map<number, DayStat>();
  for (const l of logs) addToDays(out, l, dayStartsAtHour);
  return out;
}

/** Добавить один ответ в агрегат (для потокового чтения из БД). */
export function addToDays(
  days: Map<number, DayStat>,
  l: Pick<ReviewLog, 'reviewedAt' | 'elapsedMs'>,
  dayStartsAtHour: number,
): void {
  const idx = dayIndex(l.reviewedAt, dayStartsAtHour);
  const s = days.get(idx);
  if (s) {
    s.cards++;
    s.ms += answerMs(l);
  } else {
    days.set(idx, { cards: 1, ms: answerMs(l) });
  }
}

export interface GoalProgress {
  /** Доля выполнения: any — максимум по включённым порогам, all — минимум. */
  ratio: number;
  done: boolean;
  cards: number;
  /** Минуты (дробные). */
  minutes: number;
}

export function goalProgress(stat: DayStat | undefined, goal: DailyGoal): GoalProgress {
  const cards = stat?.cards ?? 0;
  const minutes = (stat?.ms ?? 0) / 60_000;
  const ratios: number[] = [];
  if (goal.cards > 0) ratios.push(cards / goal.cards);
  if (goal.minutes > 0) ratios.push(minutes / goal.minutes);
  const ratio = ratios.length === 0 ? 0 : goal.mode === 'all' ? Math.min(...ratios) : Math.max(...ratios);
  return { ratio, done: ratios.length > 0 && ratio >= 1, cards, minutes };
}

export interface StreakInfo {
  /** Дней подряд с выполненной целью (сегодня — только если уже выполнено; прощённые не считаются). */
  current: number;
  todayDone: boolean;
  /** Серия есть, а сегодня цель ещё не выполнена. */
  atRisk: boolean;
  /** Прощённые пропуски внутри текущей серии (номера дней, от новых к старым). */
  frozenDays: number[];
  /** Пропуск сегодня можно будет простить (в последние 7 дней прощённых не было). */
  freezeAvailable: boolean;
  /** Первый день текущей серии (today, если серии нет). */
  start: number;
}

function doneFn(days: Map<number, DayStat>, goal: DailyGoal): (d: number) => boolean {
  return (d) => goalProgress(days.get(d), goal).done;
}

function minDay(days: Map<number, DayStat>, today: number): number {
  let min = today;
  for (const k of days.keys()) if (k < min) min = k;
  return min;
}

/**
 * Текущая серия: идём назад от вчера. Выполненный день +1. Пропуск прощается, если день перед ним
 * выполнен (два пропуска подряд рвут) и среди более поздних прощённых нет ни одного ближе 7 дней.
 * Невыполненное сегодня серию не рвёт.
 */
export function computeStreak(days: Map<number, DayStat>, goal: DailyGoal, today: number): StreakInfo {
  const done = doneFn(days, goal);
  const todayDone = done(today);
  const min = minDay(days, today);
  const frozenDays: number[] = [];
  let lastFrozen = Infinity;
  let count = 0;
  let start = today;
  for (let d = today - 1; d >= min - 1; d--) {
    if (done(d)) {
      count++;
      start = d;
    } else if (done(d - 1) && lastFrozen - d >= FREEZE_WINDOW) {
      frozenDays.push(d);
      lastFrozen = d;
    } else {
      break;
    }
  }
  const current = count + (todayDone ? 1 : 0);
  return {
    current,
    todayDone,
    atRisk: !todayDone && current > 0,
    frozenDays,
    freezeAvailable: frozenDays.every((f) => today - f >= FREEZE_WINDOW),
    start: current > 0 ? start : today,
  };
}

/**
 * Проход вперёд по всей истории: длины серий и прощённые пропуски. Решение о прошлом дне
 * зависит только от более ранних дней, поэтому новые данные не меняют уже посчитанное.
 */
function scanForward(
  days: Map<number, DayStat>,
  goal: DailyGoal,
  today: number,
): { best: number; frozen: Set<number> } {
  const done = doneFn(days, goal);
  const frozen = new Set<number>();
  let lastFrozen = -Infinity;
  let len = 0;
  let best = 0;
  for (let d = minDay(days, today); d < today; d++) {
    if (done(d)) {
      len++;
    } else if (done(d - 1) && (d + 1 >= today || done(d + 1)) && d - lastFrozen >= FREEZE_WINDOW) {
      frozen.add(d);
      lastFrozen = d;
    } else {
      best = Math.max(best, len);
      len = 0;
    }
  }
  if (done(today)) len++;
  return { best: Math.max(best, len), frozen };
}

/** Рекорд: самая длинная серия за всю историю (не меньше текущей). */
export function bestStreak(days: Map<number, DayStat>, goal: DailyGoal, today?: number): number {
  const t = today ?? (days.size === 0 ? 0 : Math.max(...days.keys()) + 1);
  const best = scanForward(days, goal, t).best;
  return today === undefined ? best : Math.max(best, computeStreak(days, goal, today).current);
}

export interface HeatmapCell {
  day: number;
  level: 0 | 1 | 2 | 3 | 4;
  done: boolean;
  frozen: boolean;
  cards: number;
  /** Целые минуты. */
  minutes: number;
  /** День ещё не наступил (хвост текущей недели). */
  future: boolean;
}

/**
 * Календарь за weeks недель, по 7 дней с понедельника; последняя неделя — текущая (включая будущие дни).
 * Прощённые пропуски текущей серии — как в computeStreak, более ранние — по проходу вперёд.
 */
export function heatmap(days: Map<number, DayStat>, goal: DailyGoal, today: number, weeks = 8): HeatmapCell[] {
  const streak = computeStreak(days, goal, today);
  const currentFrozen = new Set(streak.frozenDays);
  const older = scanForward(days, goal, today).frozen;
  const first = today - weekday(today) - (weeks - 1) * 7;
  const out: HeatmapCell[] = [];
  for (let day = first; day < first + weeks * 7; day++) {
    const p = goalProgress(days.get(day), goal);
    const future = day > today;
    const frozen = !future && (day >= streak.start - 1 && streak.current > 0 ? currentFrozen.has(day) : older.has(day));
    out.push({
      day,
      level: future ? 0 : levelOf(p.cards, p.ratio),
      done: p.done,
      frozen,
      cards: p.cards,
      minutes: Math.floor(p.minutes),
      future,
    });
  }
  return out;
}

function levelOf(cards: number, ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (cards === 0) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  if (ratio < 2) return 3;
  return 4;
}
