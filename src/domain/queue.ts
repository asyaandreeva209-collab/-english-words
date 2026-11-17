// Очередь на сегодня. Чистая логика: время передаётся параметром now.
import { CardStates, type Card, type Deck, type ReviewLog } from './types';

/** Learning-карточки, которые станут «к показу» в течение этого окна, возвращаются в сессию. */
export const LEARN_AHEAD_MS = 20 * 60_000;

/** Начало текущего учебного дня (локальное время): сегодня в dayStartsAtHour или вчера, если ещё рано. */
export function dayStart(now: number, dayStartsAtHour: number): number {
  const d = new Date(now);
  d.setHours(dayStartsAtHour, 0, 0, 0);
  let start = d.getTime();
  if (start > now) {
    d.setDate(d.getDate() - 1);
    start = d.getTime();
  }
  return start;
}

/** Начало следующего учебного дня. */
export function nextDayStart(now: number, dayStartsAtHour: number): number {
  const d = new Date(dayStart(now, dayStartsAtHour));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export interface QueueInput {
  /**
   * Все карточки (по всем колодам): они нужны, чтобы понять, знакомо ли уже слово
   * и сколько новых слов введено сегодня. Ограничить сессию колодой — через deckId.
   */
  cards: Card[];
  /** Колоды (для индивидуальных лимитов и исключения архивных). */
  decks: Deck[];
  /** Журнал ответов (достаточно записей за сегодня, лишние игнорируются). */
  logs: ReviewLog[];
  /** Глобальный лимит новых СЛОВ (заметок) в день. */
  newPerDay: number;
  dayStartsAtHour: number;
  now: number;
  /** Если задан — в очередь попадают только карточки этой колоды. */
  deckId?: string;
  /** «Учить ещё»: столько новых слов сверх оставшегося на сегодня (и по глобальному лимиту, и по колоде). */
  extraNew?: number;
}

export interface QueueResult {
  /**
   * Итоговый порядок показа: Learning с due ≤ now, затем перемешанные повторения и новые,
   * в конце — Learning, которые «созреют» в ближайшие LEARN_AHEAD_MS.
   */
  queue: Card[];
  /** Все Learning/Relearning в очереди (и созревшие, и «на подходе»). */
  learning: Card[];
  review: Card[];
  /** Новые карточки: первое знакомство со словом + обратные стороны уже знакомых слов. */
  fresh: Card[];
  /** Сколько новых слов (заметок) уже введено сегодня. */
  newIntroducedToday: number;
  /** Сколько новых слов ещё можно ввести сегодня (по глобальному лимиту). */
  newRemaining: number;
}

function isLearningState(c: Card): boolean {
  return c.state === CardStates.Learning || c.state === CardStates.Relearning;
}

/**
 * Строит очередь:
 * - Learning/Relearning с due ≤ now — первыми, с due ≤ now + LEARN_AHEAD_MS — в конце;
 * - Review с due ≤ now;
 * - лимит новых считается в СЛОВАХ: min(лимит колоды, глобальный) − введённые сегодня.
 *   Лимит тратит только первое знакомство со словом (все карточки заметки ещё New).
 *   Новые карточки уже знакомых слов (rev после fwd) идут сверх лимита;
 * - fwd/rev одного слова не попадают в одну сессию (вторая «закапывается» до завтра),
 *   включая случай, когда сосед уже отвечался сегодня;
 * - повторения и новые перемешиваются равномерно.
 */
export function buildQueue(input: QueueInput): QueueResult {
  const { cards, decks, logs, newPerDay, dayStartsAtHour, now, deckId } = input;
  const extraNew = Math.max(0, input.extraNew ?? 0);
  const start = dayStart(now, dayStartsAtHour);
  const deckById = new Map(decks.map((d) => [d.id, d]));

  const todayLogs = logs.filter((l) => l.reviewedAt >= start && l.reviewedAt <= now);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const cardsByNote = new Map<string, Card[]>();
  for (const c of cards) {
    let list = cardsByNote.get(c.noteId);
    if (!list) cardsByNote.set(c.noteId, (list = []));
    list.push(c);
  }

  // Какие карточки отвечались сегодня, и какие заметки «заняты» ими
  const notesTouchedToday = new Map<string, Set<string>>();
  // Карточки, впервые показанные сегодня (лог с stateBefore=New)
  const firstSeenToday = new Set<string>();
  for (const l of todayLogs) {
    if (l.stateBefore === CardStates.New) firstSeenToday.add(l.cardId);
    const noteId = cardById.get(l.cardId)?.noteId;
    if (!noteId) continue;
    let set = notesTouchedToday.get(noteId);
    if (!set) notesTouchedToday.set(noteId, (set = new Set()));
    set.add(l.cardId);
  }

  // Введено новых слов сегодня: заметки, все карточки которых либо ещё New,
  // либо впервые показаны сегодня (т. е. знакомство со словом случилось сегодня).
  // Лог удалённой карточки считаем отдельным словом — лимит он уже потратил.
  const introducedKeys = new Map<string, string>(); // ключ слова -> deckId
  for (const l of todayLogs) {
    if (l.stateBefore !== CardStates.New) continue;
    const c = cardById.get(l.cardId);
    if (!c) {
      introducedKeys.set(`card:${l.cardId}`, l.deckId);
      continue;
    }
    const siblings = cardsByNote.get(c.noteId) ?? [c];
    const firstToday = siblings.every((s) => s.state === CardStates.New || firstSeenToday.has(s.id));
    if (firstToday) introducedKeys.set(`note:${c.noteId}`, l.deckId);
  }
  const newIntroducedToday = introducedKeys.size;
  const newTodayByDeck = new Map<string, number>();
  for (const d of introducedKeys.values()) newTodayByDeck.set(d, (newTodayByDeck.get(d) ?? 0) + 1);

  // Слово уже знакомо, если у заметки есть карточка не в состоянии New
  const noteKnown = (noteId: string): boolean =>
    (cardsByNote.get(noteId) ?? []).some((c) => c.state !== CardStates.New);

  const active = cards.filter((c) => {
    if (c.suspended) return false;
    if (deckId !== undefined && c.deckId !== deckId) return false;
    const deck = deckById.get(c.deckId);
    return !!deck && !deck.archived;
  });

  // Заметки, уже представленные в сессии: noteId -> cardId
  const noteInSession = new Map<string, string>();
  const siblingBuried = (c: Card): boolean => {
    const inSession = noteInSession.get(c.noteId);
    if (inSession !== undefined && inSession !== c.id) return true;
    const touched = notesTouchedToday.get(c.noteId);
    if (touched) {
      for (const id of touched) if (id !== c.id) return true;
    }
    return false;
  };
  const take = (c: Card, into: Card[]): void => {
    noteInSession.set(c.noteId, c.id);
    into.push(c);
  };

  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: Card[] = [];

  // 1. Learning — их нельзя «закапывать», иначе шаги обучения собьются
  active
    .filter((c) => isLearningState(c) && c.due <= now + LEARN_AHEAD_MS)
    .sort((a, b) => a.due - b.due)
    .forEach((c) => take(c, learning));

  // 2. Review
  active
    .filter((c) => c.state === CardStates.Review && c.due <= now)
    .sort((a, b) => a.due - b.due)
    .forEach((c) => {
      if (!siblingBuried(c)) take(c, review);
    });

  // 3. Новые
  // extraNew прибавляется к остатку, а не к лимиту: «ещё 5» после перебора лимита — снова 5 слов
  let newRemaining = Math.max(0, newPerDay - newIntroducedToday) + extraNew;
  const newRemainingAtStart = newRemaining;
  const deckRemaining = new Map<string, number>();
  const remainingFor = (id: string): number => {
    let r = deckRemaining.get(id);
    if (r === undefined) {
      const deck = deckById.get(id);
      const limit = Math.min(deck?.newPerDay ?? newPerDay, newPerDay);
      r = Math.max(0, limit - (newTodayByDeck.get(id) ?? 0)) + extraNew;
      deckRemaining.set(id, r);
    }
    return r;
  };

  const newCandidates = active
    .filter((c) => c.state === CardStates.New)
    .sort((a, b) => a.due - b.due || dirOrder(a) - dirOrder(b) || a.id.localeCompare(b.id));
  for (const c of newCandidates) {
    if (siblingBuried(c)) continue;
    if (noteKnown(c.noteId)) {
      // Обратная сторона уже знакомого слова — сверх лимита
      take(c, fresh);
      continue;
    }
    if (newRemaining <= 0) continue;
    const r = remainingFor(c.deckId);
    if (r <= 0) continue;
    take(c, fresh);
    newRemaining--;
    deckRemaining.set(c.deckId, r - 1);
  }

  const learningDue = learning.filter((c) => c.due <= now);
  const learningAhead = learning.filter((c) => c.due > now);

  return {
    queue: [...learningDue, ...interleave(review, fresh), ...learningAhead],
    learning,
    review,
    fresh,
    newIntroducedToday,
    newRemaining: newRemainingAtStart,
  };
}

function dirOrder(c: Card): number {
  return c.direction === 'fwd' ? 0 : 1;
}

/** Равномерно вставляет элементы b между элементами a (детерминированно). */
export function interleave<T>(a: T[], b: T[]): T[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  const out: T[] = [];
  const total = a.length + b.length;
  let ia = 0;
  let ib = 0;
  for (let i = 0; i < total; i++) {
    // доля b, которая «должна» быть выдана к позиции i+1
    const wantB = Math.round(((i + 1) * b.length) / total);
    if (ib < wantB && ib < b.length) out.push(b[ib++]!);
    else if (ia < a.length) out.push(a[ia++]!);
    else out.push(b[ib++]!);
  }
  return out;
}

/**
 * После ответа: если карточка снова «созреет» в пределах LEARN_AHEAD_MS,
 * она возвращается в сессию — встаёт после карточек, которые должны быть раньше.
 * Возвращает новый массив оставшейся очереди (без текущей карточки).
 */
export function requeueAfterReview(rest: Card[], updated: Card, now: number): Card[] {
  const out = rest.filter((c) => c.id !== updated.id);
  if (updated.due > now + LEARN_AHEAD_MS) return out;
  // Ставим не раньше, чем через несколько карточек, чтобы не показывать сразу же
  const minGap = Math.min(out.length, 3);
  let pos = out.length;
  for (let i = minGap; i < out.length; i++) {
    const c = out[i]!;
    if (isLearningState(c) && c.due > updated.due) {
      pos = i;
      break;
    }
  }
  out.splice(pos, 0, updated);
  return out;
}

