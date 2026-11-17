import { describe, expect, it } from 'vitest';
import { buildQueue, dayStart, interleave, LEARN_AHEAD_MS, nextDayStart, requeueAfterReview, type QueueInput } from './queue';
import { newCard, previewDue, review } from './srs';
import { CardStates, type Card, type CardState, type Deck, type Direction, type ReviewLog } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Фиксированное «сейчас»: 15 января 2026, 12:00 по локальному времени. */
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const NO_FUZZ = { enableFuzz: false };

const deck = (id = 'd1', extra: Partial<Deck> = {}): Deck => ({
  id,
  name: id,
  kind: 'vocab',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

let seq = 0;
function card(p: {
  id?: string;
  noteId?: string;
  deckId?: string;
  direction?: Direction;
  state?: CardState;
  due?: number;
  suspended?: boolean;
}): Card {
  const id = p.id ?? `c${++seq}`;
  const c: Card = {
    ...newCard(p.due ?? NOW - DAY),
    id,
    noteId: p.noteId ?? `n-${id}`,
    deckId: p.deckId ?? 'd1',
    direction: p.direction ?? 'fwd',
    updatedAt: 0,
  };
  if (p.state !== undefined) c.state = p.state;
  if (p.due !== undefined) c.due = p.due;
  if (p.suspended) c.suspended = true;
  return c;
}

function log(cardId: string, reviewedAt: number, stateBefore: CardState = CardStates.New, deckId = 'd1'): ReviewLog {
  return { id: `l-${cardId}-${reviewedAt}`, cardId, deckId, rating: 3, mode: 'flash', stateBefore, reviewedAt };
}

const input = (p: Partial<QueueInput>): QueueInput => ({
  cards: [],
  decks: [deck()],
  logs: [],
  newPerDay: 20,
  dayStartsAtHour: 4,
  now: NOW,
  ...p,
});

const ids = (cs: Card[]) => cs.map((c) => c.id);

describe('dayStart / nextDayStart', () => {
  it('днём: сегодня в 4:00', () => {
    expect(dayStart(NOW, 4)).toBe(new Date(2026, 0, 15, 4).getTime());
    expect(nextDayStart(NOW, 4)).toBe(new Date(2026, 0, 16, 4).getTime());
  });

  it('в 03:00 — ещё предыдущий учебный день', () => {
    const t = new Date(2026, 0, 15, 3, 0).getTime();
    expect(dayStart(t, 4)).toBe(new Date(2026, 0, 14, 4).getTime());
    expect(nextDayStart(t, 4)).toBe(new Date(2026, 0, 15, 4).getTime());
  });

  it('ровно в 4:00 — уже новый день', () => {
    const t = new Date(2026, 0, 15, 4, 0).getTime();
    expect(dayStart(t, 4)).toBe(t);
  });

  it('переход через месяц', () => {
    const t = new Date(2026, 1, 1, 2).getTime();
    expect(dayStart(t, 4)).toBe(new Date(2026, 0, 31, 4).getTime());
  });
});

describe('buildQueue: новые карточки и лимит', () => {
  it('лимит новых соблюдается', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    const q = buildQueue(input({ cards, newPerDay: 3 }));
    expect(q.fresh).toHaveLength(3);
    expect(q.newRemaining).toBe(3);
  });

  it('новые выдаются в порядке due (порядок ввода)', () => {
    const a = card({ id: 'a', due: NOW - 3 });
    const b = card({ id: 'b', due: NOW - 2 });
    const c = card({ id: 'c', due: NOW - 1 });
    const q = buildQueue(input({ cards: [c, a, b], newPerDay: 2 }));
    expect(ids(q.fresh)).toEqual(['a', 'b']);
  });

  it('учитываются введённые сегодня (ReviewLog stateBefore=New)', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    const logs = [
      log('old1', NOW - HOUR),
      log('old2', NOW - 2 * HOUR),
      log('old3', NOW - 3 * HOUR, CardStates.Review), // не новая — не считается
    ];
    const q = buildQueue(input({ cards, logs, newPerDay: 5 }));
    expect(q.newIntroducedToday).toBe(2);
    expect(q.newRemaining).toBe(3);
    expect(q.fresh).toHaveLength(3);
  });

  it('лимит исчерпан — новых нет', () => {
    const cards = [card({})];
    const logs = [log('x', NOW - HOUR), log('y', NOW - HOUR + 1)];
    const q = buildQueue(input({ cards, logs, newPerDay: 2 }));
    expect(q.fresh).toEqual([]);
    expect(q.newRemaining).toBe(0);
  });

  it('введённые до 4:00 сегодня относятся ко вчера и не уменьшают лимит', () => {
    const cards = Array.from({ length: 5 }, () => card({}));
    const logs = [log('x', new Date(2026, 0, 15, 3, 59).getTime()), log('y', new Date(2026, 0, 15, 4, 0).getTime())];
    const q = buildQueue(input({ cards, logs, newPerDay: 3 }));
    expect(q.newIntroducedToday).toBe(1);
    expect(q.fresh).toHaveLength(2);
  });

  it('в 03:00 лог от вчера 23:00 считается «сегодняшним»', () => {
    const now = new Date(2026, 0, 15, 3, 0).getTime();
    const cards = Array.from({ length: 5 }, () => card({ due: now - DAY }));
    const logs = [
      log('x', new Date(2026, 0, 14, 23, 0).getTime()),
      log('y', new Date(2026, 0, 14, 3, 0).getTime()), // позавчерашний учебный день
    ];
    const q = buildQueue(input({ cards, logs, newPerDay: 3, now }));
    expect(q.newIntroducedToday).toBe(1);
    expect(q.fresh).toHaveLength(2);
  });

  it('лимит колоды меньше глобального', () => {
    const cards = Array.from({ length: 5 }, () => card({}));
    const q = buildQueue(input({ cards, decks: [deck('d1', { newPerDay: 2 })], newPerDay: 10 }));
    expect(q.fresh).toHaveLength(2);
  });

  it('лимит колоды учитывает введённые сегодня в этой колоде', () => {
    const cards = Array.from({ length: 5 }, () => card({}));
    const logs = [log('x', NOW - HOUR)];
    const q = buildQueue(input({ cards, logs, decks: [deck('d1', { newPerDay: 2 })], newPerDay: 10 }));
    expect(q.fresh).toHaveLength(1);
  });

  it('глобальный лимит общий для нескольких колод', () => {
    const cards = [
      ...Array.from({ length: 3 }, () => card({ deckId: 'd1' })),
      ...Array.from({ length: 3 }, () => card({ deckId: 'd2' })),
    ];
    const q = buildQueue(input({ cards, decks: [deck('d1'), deck('d2')], newPerDay: 4 }));
    expect(q.fresh).toHaveLength(4);
  });

  it('лимит 0 — новых нет', () => {
    const q = buildQueue(input({ cards: [card({})], newPerDay: 0 }));
    expect(q.fresh).toEqual([]);
  });
});

describe('buildQueue: «Учить ещё» (extraNew)', () => {
  it('без extraNew — как раньше', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    const logs = [log('x', NOW - HOUR), log('y', NOW - HOUR + 1)];
    const q = buildQueue(input({ cards, logs, newPerDay: 2 }));
    expect(q.fresh).toEqual([]);
    expect(q.newRemaining).toBe(0);
  });

  it('поднимает глобальный лимит сверх исчерпанного', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    const logs = [log('x', NOW - HOUR), log('y', NOW - HOUR + 1)];
    const q = buildQueue(input({ cards, logs, newPerDay: 2, extraNew: 5 }));
    expect(q.fresh).toHaveLength(5);
    expect(q.newRemaining).toBe(5);
  });

  it('прибавляется к остатку: после перебора лимита — снова столько же', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    // Лимит 2, а сегодня уже введено 4 (одно «ещё» уже было)
    const logs = ['a', 'b', 'c', 'd'].map((id, i) => log(id, NOW - HOUR + i));
    const q = buildQueue(input({ cards, logs, newPerDay: 2, extraNew: 3 }));
    expect(q.fresh).toHaveLength(3);
  });

  it('поднимает и лимит колоды', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    const logs = [log('x', NOW - HOUR)];
    const decks = [deck('d1', { newPerDay: 1 })];
    expect(buildQueue(input({ cards, logs, decks, newPerDay: 10 })).fresh).toEqual([]);
    expect(buildQueue(input({ cards, logs, decks, newPerDay: 10, extraNew: 5 })).fresh).toHaveLength(5);
  });

  it('с лимитом 0 — ровно extraNew', () => {
    const cards = Array.from({ length: 10 }, () => card({}));
    expect(buildQueue(input({ cards, newPerDay: 0, extraNew: 5 })).fresh).toHaveLength(5);
  });
});

describe('buildQueue: лимит в словах', () => {
  /** Пара карточек fwd/rev одного слова. */
  function word(i: number, deckId = 'd1'): Card[] {
    const due = NOW - DAY + i;
    return [
      card({ id: `f${i}`, noteId: `w${i}`, deckId, direction: 'fwd', due }),
      card({ id: `r${i}`, noteId: `w${i}`, deckId, direction: 'rev', due }),
    ];
  }

  it('rev уже знакомого слова идёт сверх лимита', () => {
    const [f0, r0] = word(0);
    const known: Card = { ...f0!, state: CardStates.Review, due: NOW + 10 * DAY };
    const others = [1, 2, 3].flatMap((i) => word(i));
    const q = buildQueue(input({ cards: [known, r0!, ...others], newPerDay: 2 }));
    expect(ids(q.fresh).sort()).toEqual(['f1', 'f2', 'r0']);
    expect(q.newRemaining).toBe(2);
  });

  it('введённым сегодня считается слово, а не карточка', () => {
    // Сегодня впервые показали fwd слова 0 (дважды: Again, потом Good)
    const [f0, r0] = word(0);
    const learning: Card = { ...f0!, state: CardStates.Learning, due: NOW + HOUR };
    const logs = [log('f0', NOW - 2 * HOUR), log('f0', NOW - HOUR, CardStates.Learning)];
    const q = buildQueue(input({ cards: [learning, r0!, ...word(1), ...word(2)], logs, newPerDay: 2 }));
    expect(q.newIntroducedToday).toBe(1);
    expect(ids(q.fresh)).toEqual(['f1']);
  });

  it('первое показанное сегодня rev знакомого слова лимит не тратит', () => {
    const [f0, r0] = word(0);
    const fwd: Card = { ...f0!, state: CardStates.Review, due: NOW + 10 * DAY, last_review: NOW - DAY };
    const rev: Card = { ...r0!, state: CardStates.Learning, due: NOW + HOUR };
    const logs = [log('r0', NOW - HOUR)];
    const q = buildQueue(input({ cards: [fwd, rev, ...word(1)], logs, newPerDay: 1 }));
    expect(q.newIntroducedToday).toBe(0);
    expect(ids(q.fresh)).toEqual(['f1']);
  });

  it('deckId ограничивает очередь, но введённые в других колодах учитываются глобально', () => {
    const [f0] = word(0, 'd2');
    const learning: Card = { ...f0!, state: CardStates.Learning, due: NOW + HOUR };
    const cards = [learning, ...word(1, 'd1'), ...word(2, 'd1')];
    const q = buildQueue(
      input({ cards, decks: [deck('d1'), deck('d2')], logs: [log('f0', NOW - HOUR, CardStates.New, 'd2')], newPerDay: 2, deckId: 'd1' }),
    );
    expect(q.newIntroducedToday).toBe(1);
    expect(ids(q.queue)).toEqual(['f1']);
  });

  it('3 дня подряд: 100 слов, лимит 10 → каждый день 10 новых fwd, со 2-го дня ещё 10 rev', () => {
    let cards: Card[] = Array.from({ length: 100 }, (_, i) => word(i)).flat();
    const logs: ReviewLog[] = [];
    for (let day = 0; day < 3; day++) {
      const now = NOW + day * DAY;
      const q = buildQueue(input({ cards, logs, newPerDay: 10, now }));
      const fwd = q.fresh.filter((c) => c.direction === 'fwd');
      const rev = q.fresh.filter((c) => c.direction === 'rev');
      expect(fwd).toHaveLength(10);
      expect(rev).toHaveLength(day === 0 ? 0 : 10);
      // Новые слова идут по порядку ввода, rev — от слов, введённых вчера
      expect(ids(fwd)).toEqual(Array.from({ length: 10 }, (_, i) => `f${day * 10 + i}`));
      if (day > 0) expect(ids(rev)).toEqual(Array.from({ length: 10 }, (_, i) => `r${(day - 1) * 10 + i}`));
      expect(q.newRemaining).toBe(10);

      // «Отвечаем» на все новые: карточка уходит в Review надолго
      const answered = new Set(ids(q.fresh));
      for (const c of q.fresh) logs.push(log(c.id, now + MIN, CardStates.New));
      cards = cards.map((c) => (answered.has(c.id) ? { ...c, state: CardStates.Review, due: now + 30 * DAY, last_review: now + MIN } : c));

      const after = buildQueue(input({ cards, logs, newPerDay: 10, now: now + 2 * MIN }));
      expect(after.newIntroducedToday).toBe(10);
      expect(after.fresh).toEqual([]);
    }
  });

  it('grammar: одна карточка на заметку, лимит в заметках', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card({ id: `g${i}`, noteId: `gn${i}`, due: NOW - DAY + i }));
    const q = buildQueue(input({ cards, decks: [deck('d1', { kind: 'grammar' })], newPerDay: 3 }));
    expect(ids(q.fresh)).toEqual(['g0', 'g1', 'g2']);
  });
});

describe('buildQueue: повторения и обучение', () => {
  it('Review с due ≤ now попадает, с due > now — нет', () => {
    const due = card({ id: 'due', state: CardStates.Review, due: NOW - HOUR });
    const exact = card({ id: 'exact', state: CardStates.Review, due: NOW });
    const later = card({ id: 'later', state: CardStates.Review, due: NOW + MIN });
    const q = buildQueue(input({ cards: [later, due, exact] }));
    expect(ids(q.review)).toEqual(['due', 'exact']);
  });

  it('Learning с due в пределах 20 минут попадает, дальше — нет', () => {
    const soon = card({ id: 'soon', state: CardStates.Learning, due: NOW + 10 * MIN });
    const edge = card({ id: 'edge', state: CardStates.Learning, due: NOW + LEARN_AHEAD_MS });
    const relearn = card({ id: 'relearn', state: CardStates.Relearning, due: NOW - MIN });
    const far = card({ id: 'far', state: CardStates.Learning, due: NOW + 21 * MIN });
    const q = buildQueue(input({ cards: [far, soon, edge, relearn] }));
    expect(ids(q.learning)).toEqual(['relearn', 'soon', 'edge']);
  });

  it('созревшие Learning-карточки (due ≤ now) идут в начале очереди', () => {
    const l = card({ id: 'l', state: CardStates.Learning, due: NOW - MIN });
    const r = card({ id: 'r', state: CardStates.Review, due: NOW - DAY });
    const n = card({ id: 'n' });
    const q = buildQueue(input({ cards: [r, n, l] }));
    expect(q.queue[0]?.id).toBe('l');
    expect(ids(q.queue).sort()).toEqual(['l', 'n', 'r']);
  });

  it('Learning «на подходе» (now < due ≤ now+20м) — в конце очереди', () => {
    const ahead = card({ id: 'ahead', state: CardStates.Learning, due: NOW + 5 * MIN });
    const ready = card({ id: 'ready', state: CardStates.Relearning, due: NOW });
    const r = card({ id: 'r', state: CardStates.Review, due: NOW - DAY });
    const n = card({ id: 'n' });
    const q = buildQueue(input({ cards: [ahead, r, n, ready] }));
    expect(q.queue[0]?.id).toBe('ready');
    expect(q.queue.at(-1)?.id).toBe('ahead');
    expect(ids(q.learning).sort()).toEqual(['ahead', 'ready']);
  });

  it('suspended исключаются из всех категорий', () => {
    const cards = [
      card({ suspended: true }),
      card({ state: CardStates.Review, due: NOW - HOUR, suspended: true }),
      card({ state: CardStates.Learning, due: NOW, suspended: true }),
    ];
    const q = buildQueue(input({ cards }));
    expect(q.queue).toEqual([]);
  });

  it('карточки архивных и неизвестных колод исключаются', () => {
    const cards = [card({ deckId: 'arch' }), card({ deckId: 'missing' })];
    const q = buildQueue(input({ cards, decks: [deck('arch', { archived: true })] }));
    expect(q.queue).toEqual([]);
  });

  it('повторения и новые перемешиваются', () => {
    const reviews = Array.from({ length: 4 }, (_, i) => card({ id: `r${i}`, state: CardStates.Review, due: NOW - DAY + i }));
    const fresh = Array.from({ length: 4 }, (_, i) => card({ id: `n${i}`, due: NOW - DAY + i }));
    const q = buildQueue(input({ cards: [...reviews, ...fresh] }));
    const kinds = q.queue.map((c) => c.id[0]).join('');
    expect(kinds).not.toBe('rrrrnnnn');
    expect(kinds).not.toBe('nnnnrrrr');
    expect(q.queue).toHaveLength(8);
  });
});

describe('buildQueue: sibling burying', () => {
  it('fwd и rev одного новой заметки не попадают в одну сессию', () => {
    const fwd = card({ id: 'f', noteId: 'n1', direction: 'fwd' });
    const rev = card({ id: 'r', noteId: 'n1', direction: 'rev' });
    const q = buildQueue(input({ cards: [rev, fwd] }));
    expect(ids(q.queue)).toEqual(['f']);
  });

  it('закопанный сосед не занимает место в лимите', () => {
    const cards = [
      card({ id: 'f1', noteId: 'n1', direction: 'fwd', due: NOW - 10 }),
      card({ id: 'r1', noteId: 'n1', direction: 'rev', due: NOW - 10 }),
      card({ id: 'f2', noteId: 'n2', direction: 'fwd', due: NOW - 5 }),
      card({ id: 'r2', noteId: 'n2', direction: 'rev', due: NOW - 5 }),
    ];
    const q = buildQueue(input({ cards, newPerDay: 2 }));
    expect(ids(q.fresh)).toEqual(['f1', 'f2']);
  });

  it('два Review-соседа: в сессию попадает только один', () => {
    const fwd = card({ id: 'f', noteId: 'n1', state: CardStates.Review, due: NOW - HOUR });
    const rev = card({ id: 'r', noteId: 'n1', direction: 'rev', state: CardStates.Review, due: NOW - 2 * HOUR });
    const q = buildQueue(input({ cards: [fwd, rev] }));
    expect(q.queue).toHaveLength(1);
  });

  it('если соседняя карточка уже отвечалась сегодня — вторая закапывается', () => {
    const fwd = card({ id: 'f', noteId: 'n1', state: CardStates.Review, due: NOW + 5 * DAY });
    const rev = card({ id: 'r', noteId: 'n1', direction: 'rev' });
    const q = buildQueue(input({ cards: [fwd, rev], logs: [log('f', NOW - HOUR)] }));
    expect(q.fresh).toEqual([]);

    const revReview = card({ id: 'r2', noteId: 'n1', direction: 'rev', state: CardStates.Review, due: NOW - HOUR });
    const q2 = buildQueue(input({ cards: [fwd, revReview], logs: [log('f', NOW - HOUR, CardStates.Review)] }));
    expect(q2.review).toEqual([]);
  });

  it('ответ соседа вчера (до 4:00) не закапывает', () => {
    const fwd = card({ id: 'f', noteId: 'n1', state: CardStates.Review, due: NOW + 5 * DAY });
    const rev = card({ id: 'r', noteId: 'n1', direction: 'rev' });
    const q = buildQueue(input({ cards: [fwd, rev], logs: [log('f', new Date(2026, 0, 15, 3).getTime())] }));
    expect(ids(q.fresh)).toEqual(['r']);
  });

  it('собственный ответ сегодня карточку не закапывает', () => {
    const l = card({ id: 'l', noteId: 'n1', state: CardStates.Learning, due: NOW + MIN });
    const q = buildQueue(input({ cards: [l], logs: [log('l', NOW - MIN)] }));
    expect(ids(q.learning)).toEqual(['l']);
  });

  it('новый сосед Learning-карточки в сессии не появляется', () => {
    const l = card({ id: 'l', noteId: 'n1', state: CardStates.Learning, due: NOW + MIN });
    const n = card({ id: 'n', noteId: 'n1', direction: 'rev' });
    const q = buildQueue(input({ cards: [l, n] }));
    expect(ids(q.queue)).toEqual(['l']);
  });
});

describe('interleave', () => {
  it('сохраняет все элементы и их относительный порядок', () => {
    const out = interleave<number | string>([1, 2, 3, 4], ['a', 'b']);
    expect(out).toHaveLength(6);
    expect(out.filter((x) => typeof x === 'number')).toEqual([1, 2, 3, 4]);
    expect(out.filter((x) => typeof x === 'string')).toEqual(['a', 'b']);
  });

  it('пустые массивы', () => {
    expect(interleave([], [1])).toEqual([1]);
    expect(interleave([1], [])).toEqual([1]);
    expect(interleave([], [])).toEqual([]);
  });
});

describe('srs', () => {
  it('newCard: state New, due = now', () => {
    const c = newCard(NOW);
    expect(c.state).toBe(CardStates.New);
    expect(c.due).toBe(NOW);
    expect(c.reps).toBe(0);
  });

  it('review не мутирует входную карточку', () => {
    const c = newCard(NOW);
    const copy = { ...c };
    review(c, 3, NOW, NO_FUZZ);
    expect(c).toEqual(copy);
  });

  it('Easy даёт интервал больше, чем Good (новая карточка)', () => {
    const c = newCard(NOW);
    const good = review(c, 3, NOW, NO_FUZZ);
    const easy = review(c, 4, NOW, NO_FUZZ);
    expect(easy.due).toBeGreaterThan(good.due);
    expect(easy.state).toBe(CardStates.Review);
  });

  it('Easy > Good > Hard > Again для Review-карточки', () => {
    let c = newCard(NOW);
    c = review(c, 3, NOW, NO_FUZZ);
    c = review(c, 3, NOW + 10 * MIN, NO_FUZZ);
    expect(c.state).toBe(CardStates.Review);
    const t = c.due;
    const p = previewDue(c, t);
    expect(p[4]).toBeGreaterThan(p[3]);
    expect(p[3]).toBeGreaterThan(p[2]);
    expect(p[2]).toBeGreaterThan(p[1]);
  });

  it('Again на новой карточке — Learning с due в пределах LEARN_AHEAD_MS', () => {
    const again = review(newCard(NOW), 1, NOW, NO_FUZZ);
    expect(again.state).toBe(CardStates.Learning);
    expect(again.due).toBeGreaterThan(NOW);
    expect(again.due).toBeLessThanOrEqual(NOW + LEARN_AHEAD_MS);
  });

  it('Again на Review-карточке — Relearning, lapses+1', () => {
    let c = newCard(NOW);
    c = review(c, 4, NOW, NO_FUZZ);
    const lapsed = review(c, 1, c.due, NO_FUZZ);
    expect(lapsed.state).toBe(CardStates.Relearning);
    expect(lapsed.lapses).toBe(c.lapses + 1);
  });

  it('previewDue совпадает с review без фаззинга', () => {
    const c = newCard(NOW);
    const p = previewDue(c, NOW);
    for (const r of [1, 2, 3, 4] as const) expect(p[r]).toBe(review(c, r, NOW, NO_FUZZ).due);
  });
});

describe('requeueAfterReview', () => {
  const base = card({ id: 'x', noteId: 'nx' });

  it('Again возвращает карточку в очередь', () => {
    const rest = [card({ id: 'a' }), card({ id: 'b' })];
    const updated: Card = { ...base, ...review(base, 1, NOW, NO_FUZZ) };
    const out = requeueAfterReview([base, ...rest], updated, NOW);
    expect(ids(out)).toEqual(['a', 'b', 'x']);
    expect(out.at(-1)?.state).toBe(CardStates.Learning);
  });

  it('Easy (due через дни) — карточка уходит из очереди', () => {
    const rest = [card({ id: 'a' })];
    const updated: Card = { ...base, ...review(base, 4, NOW, NO_FUZZ) };
    expect(ids(requeueAfterReview([base, ...rest], updated, NOW))).toEqual(['a']);
  });

  it('вставляется не раньше, чем через 3 карточки', () => {
    const rest = Array.from({ length: 6 }, (_, i) =>
      card({ id: `l${i}`, state: CardStates.Learning, due: NOW + 15 * MIN + i }),
    );
    const updated: Card = { ...base, state: CardStates.Learning, due: NOW + MIN };
    const out = requeueAfterReview(rest, updated, NOW);
    expect(out.findIndex((c) => c.id === 'x')).toBe(3);
  });

  it('встаёт перед Learning-карточкой с более поздним due', () => {
    const rest = [
      card({ id: 'a' }),
      card({ id: 'b' }),
      card({ id: 'c' }),
      card({ id: 'd', state: CardStates.Learning, due: NOW + MIN }),
      card({ id: 'e', state: CardStates.Learning, due: NOW + 15 * MIN }),
      card({ id: 'f' }),
    ];
    const updated: Card = { ...base, state: CardStates.Learning, due: NOW + 10 * MIN };
    expect(ids(requeueAfterReview(rest, updated, NOW))).toEqual(['a', 'b', 'c', 'd', 'x', 'e', 'f']);
  });

  it('пустой остаток — карточка единственная', () => {
    const updated: Card = { ...base, state: CardStates.Learning, due: NOW + MIN };
    expect(ids(requeueAfterReview([base], updated, NOW))).toEqual(['x']);
  });
});
