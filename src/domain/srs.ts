// Обёртка над ts-fsrs: перевод между нашими полями (ms) и Card библиотеки (Date).
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import type { CardState, Rating, SrsFields } from './types';

export interface SchedulerOptions {
  desiredRetention?: number;
  /** Случайный разброс длинных интервалов. В тестах лучше выключать. */
  enableFuzz?: boolean;
}

export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Снова',
  2: 'Трудно',
  3: 'Хорошо',
  4: 'Легко',
};

const schedulerCache = new Map<string, FSRS>();

export function getScheduler(opts: SchedulerOptions = {}): FSRS {
  const retention = opts.desiredRetention ?? 0.9;
  const fuzz = opts.enableFuzz ?? true;
  const key = `${retention}|${fuzz}`;
  let s = schedulerCache.get(key);
  if (!s) {
    s = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: fuzz, enable_short_term: true }));
    schedulerCache.set(key, s);
  }
  return s;
}

function toFsrs(f: SrsFields): FsrsCard {
  return {
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsed_days,
    scheduled_days: f.scheduled_days,
    learning_steps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    last_review: f.last_review !== undefined ? new Date(f.last_review) : undefined,
  };
}

function fromFsrs(c: FsrsCard): SrsFields {
  const f: SrsFields = {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number as CardState,
  };
  if (c.last_review) f.last_review = c.last_review.getTime();
  return f;
}

/** Поля новой карточки (state New, due = now). */
export function newCard(now: number): SrsFields {
  return fromFsrs(createEmptyCard(new Date(now)));
}

/** Результат ответа: новые поля карточки. Входная карточка не меняется. */
export function review(card: SrsFields, rating: Rating, now: number, opts?: SchedulerOptions): SrsFields {
  const res = getScheduler(opts).next(toFsrs(card), new Date(now), rating as Grade);
  return fromFsrs(res.card);
}

/** Время следующего показа (ms) для каждой оценки — для подписей на кнопках. */
export function previewDue(card: SrsFields, now: number, opts?: SchedulerOptions): Record<Rating, number> {
  const s = getScheduler({ ...opts, enableFuzz: false });
  const nowDate = new Date(now);
  const fc = toFsrs(card);
  const out = {} as Record<Rating, number>;
  for (const r of RATINGS) {
    out[r] = s.next(fc, nowDate, r as Grade).card.due.getTime();
  }
  return out;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Короткая русская подпись интервала: «<1 мин», «10 мин», «3 ч», «5 дн», «2 мес», «1,5 г». */
export function formatInterval(ms: number): string {
  if (ms < MIN) return '<1 мин';
  if (ms < HOUR) return `${Math.round(ms / MIN)} мин`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} ч`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)} дн`;
  if (days < 365) return `${fmt1(days / 30)} мес`;
  return `${fmt1(days / 365)} г`;
}

function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r).replace('.', ',');
}
