// Сессия «Карточки»: Space/Enter — показать ответ, 1–4 — оценки, Ctrl+Z — отменить.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { db } from '../../db/schema';
import { CardNotFoundError, recordReview, undoReview, type ReviewResult } from '../../db/repo';
import { requeueAfterReview } from '../../domain/queue';
import { formatInterval, previewDue, RATING_LABELS, RATINGS } from '../../domain/srs';
import type { Card, Deck, Note, Rating, Settings } from '../../domain/types';
import { loadQueue, MORE_NEW } from './loadQueue';
import { Markdown } from '../../ui/Markdown';
import { SpeakButton } from '../../ui/SpeakButton';
import { speak } from '../../ui/tts';
import { IconBack } from '../../ui/icons';
import { useToast } from '../../ui/Toast';
import { daysInRow, plural } from '../../ui/plural';
import { useStreak } from '../../db/hooks';
import { goalProgress } from '../../domain/streak';

/** ?more=5 — положительное целое, иначе undefined. */
function parseMore(v: string | null): number | undefined {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n > 0 ? n : undefined;
}

interface SessionData {
  settings: Settings;
  notes: Map<string, Note>;
  decks: Map<string, Deck>;
}

export function StudyPage() {
  const [params, setParams] = useSearchParams();
  const deckId = params.get('deck') ?? undefined;
  const extraNew = parseMore(params.get('more'));
  // «Учить ещё» на том же URL (?more=5 уже стоит) — перезагрузить очередь
  const [round, setRound] = useState(0);
  const [moreAvailable, setMoreAvailable] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState<SessionData | null>(null);
  const [queue, setQueue] = useState<Card[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<ReviewResult[]>([]);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  // Сколько вкладка была скрыта с момента показа карточки — это время в ответ не засчитываем
  const hiddenMs = useRef(0);
  const hiddenSince = useRef<number | null>(null);
  const resetTimer = useCallback(() => {
    shownAt.current = Date.now();
    hiddenMs.current = 0;
    if (hiddenSince.current !== null) hiddenSince.current = Date.now();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince.current ??= Date.now();
      } else if (hiddenSince.current !== null) {
        hiddenMs.current += Date.now() - hiddenSince.current;
        hiddenSince.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const [sessionStart] = useState(() => Date.now());
  const streakState = useStreak(sessionStart);
  const streak = streakState?.streak;
  // Тост — только при переходе «не выполнена → выполнена» за эту сессию
  const prevTodayDone = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!streak) return;
    if (prevTodayDone.current === false && streak.todayDone) {
      toast(`Цель дня выполнена! 🔥 ${daysInRow(streak.current)}`);
    }
    prevTodayDone.current = streak.todayDone;
  }, [streak, toast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const q = await loadQueue(Date.now(), deckId, extraNew);
      const noteIds = [...new Set(q.queue.map((c) => c.noteId))];
      const [notes, decks] = await Promise.all([db.notes.bulkGet(noteIds), db.decks.toArray()]);
      if (cancelled) return;
      setData({
        settings: q.settings,
        notes: new Map(notes.filter((n): n is Note => !!n).map((n) => [n.id, n])),
        decks: new Map(decks.map((d) => [d.id, d])),
      });
      setQueue(q.queue);
      resetTimer();
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, extraNew, round, resetTimer]);

  // Очередь кончилась — есть ли ещё новые слова сверх лимита (для кнопки «Ещё 5 новых слов»)
  const queueEmpty = !!data && queue.length === 0;
  useEffect(() => {
    if (!queueEmpty) return;
    let cancelled = false;
    void loadQueue(Date.now(), deckId, MORE_NEW).then((q) => {
      if (!cancelled) setMoreAvailable(q.fresh.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [queueEmpty, deckId]);

  const learnMore = () => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('more', String(MORE_NEW));
        return next;
      },
      { replace: true },
    );
    setRound((r) => r + 1);
  };

  const current = queue[0];
  const note = current ? data?.notes.get(current.noteId) : undefined;
  const deck = current ? data?.decks.get(current.deckId) : undefined;
  const isGrammar = deck?.kind === 'grammar';
  const tts = !!data?.settings.ttsEnabled && !isGrammar;

  // Английская сторона видна: fwd — сразу, rev — после ответа
  const englishVisible = !!current && (current.direction === 'fwd' || revealed);
  useEffect(() => {
    if (tts && englishVisible && note) speak(note.front);
  }, [tts, englishVisible, note, current?.id]);

  const intervals = useMemo(() => {
    if (!current || !revealed || !data) return null;
    const now = Date.now();
    const due = previewDue(current, now, { desiredRetention: data.settings.desiredRetention });
    const out = {} as Record<Rating, string>;
    for (const r of RATINGS) out[r] = formatInterval(due[r] - now);
    return out;
  }, [current, revealed, data]);

  const reveal = useCallback(() => setRevealed(true), []);

  // Карточки без заметки (слово удалили) выкидываем и переходим к следующей
  useEffect(() => {
    if (data && current && !data.notes.has(current.noteId)) {
      setQueue((q) => q.filter((c) => c.id !== current.id));
    }
  }, [data, current]);

  // Синхронный гард: setState не успевает обновиться между двумя быстрыми нажатиями
  const busyRef = useRef(false);
  // id карточки, которая сейчас на экране: колбэк с устаревшим замыканием не должен оценить другую
  const currentIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    currentIdRef.current = queue[0]?.id;
  }, [queue]);

  const dropCard = useCallback((cardId: string) => {
    setQueue((q) => q.filter((c) => c.id !== cardId));
    setHistory((h) => h.filter((r) => r.card.id !== cardId));
    setRevealed(false);
  }, []);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!current || !revealed || !data || busyRef.current) return;
      if (currentIdRef.current !== current.id) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const now = Date.now();
        const res = await recordReview(current, rating, {
          mode: 'flash',
          now,
          elapsedMs: Math.max(0, now - shownAt.current - hiddenMs.current),
          scheduler: { desiredRetention: data.settings.desiredRetention },
        });
        // Эта карточка оценена: до обновления очереди повторная оценка по старому замыканию не пройдёт
        currentIdRef.current = undefined;
        setHistory((h) => [...h, res]);
        // requeueAfterReview убирает карточку по id и при необходимости возвращает её в очередь
        setQueue((q) => requeueAfterReview(q, res.card, now));
        setRevealed(false);
        resetTimer();
      } catch (err) {
        if (err instanceof CardNotFoundError) {
          dropCard(current.id);
          toast('Это слово было удалено — пропускаем');
        } else {
          toast('Не удалось сохранить ответ');
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [current, revealed, data, toast, dropCard, resetTimer],
  );

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await undoReview(last);
      setHistory((h) => h.filter((r) => r !== last));
      setQueue((q) => [last.previous, ...q.filter((c) => c.id !== last.previous.id)]);
      setRevealed(true);
      resetTimer();
    } catch (err) {
      if (err instanceof CardNotFoundError) {
        dropCard(last.previous.id);
        toast('Это слово было удалено — отменить нельзя');
      } else {
        toast('Не удалось отменить оценку');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [history, toast, dropCard, resetTimer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (!e.repeat) void undo();
        return;
      }
      // Прочие сочетания с модификаторами — браузеру
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Фокус на кнопке/ссылке (Tab + Enter) — пусть сработает она. «Отменить» после клика мышью
        // сама снимает фокус, так что случайного повторного нажатия не будет.
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        e.preventDefault();
        if (!e.repeat && !revealed) reveal();
        return;
      }
      if (revealed && !e.repeat && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as Rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, reveal, rate, undo]);

  const goBack = () => {
    // Открыли сессию по прямой ссылке — «назад» некуда, идём на главную
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/');
  };

  if (!data) return null;

  const done = history.length;
  const progress = done + queue.length > 0 ? (done / (done + queue.length)) * 100 : 100;

  const header = (
    <div className="row row--between">
      <button type="button" className="btn btn--ghost btn--sm" onClick={goBack}>
        <IconBack /> Назад
      </button>
      <span className="muted small">
        {deck ? deck.name : deckId ? '' : 'Все колоды'} · осталось {queue.length}
      </span>
      <button type="button" className="btn btn--ghost btn--sm" disabled={history.length === 0 || busy}
        onClick={(e) => {
          e.currentTarget.blur();
          void undo();
        }}
      >
        Отменить последнюю оценку
      </button>
    </div>
  );

  if (!current || !note) {
    const goal = streakState?.goal;
    const goalProg = streakState?.goal ? goalProgress(streakState.days.get(streakState.today), streakState.goal) : null;
    const goalLeft: string[] = [];
    if (goal && goalProg && !goalProg.done) {
      if (goal.minutes > 0 && goalProg.minutes < goal.minutes) goalLeft.push(`${Math.ceil(goal.minutes - goalProg.minutes)} мин`);
      if (goal.cards > 0 && goalProg.cards < goal.cards) {
        const n = goal.cards - goalProg.cards;
        goalLeft.push(`${n} ${plural(n, 'ответ', 'ответа', 'ответов')}`);
      }
    }
    return (
      <div className="study">
        {header}
        <div className="card empty">
          <h2>{done > 0 ? 'Готово!' : 'Сейчас нечего учить'}</h2>
          <p>
            {done > 0
              ? `Ответов за сессию: ${done}. Следующие повторения алгоритм назначит сам.`
              : 'Новые слова на сегодня закончились, а повторять пока рано.'}
          </p>
          {streak && goalProg && (
            <p>
              {goalProg.done
                ? `Цель дня выполнена! 🔥 ${daysInRow(streak.current)}`
                : `До цели: ${goalLeft.join(goal?.mode === 'all' ? ' и ' : ' или ')}`}
            </p>
          )}
          <div className="row" style={{ justifyContent: 'center' }}>
            {goalProg && !goalProg.done &&
              (moreAvailable ? (
                <button type="button" className="btn btn--primary" onClick={learnMore}>
                  Ещё {MORE_NEW} новых слов
                </button>
              ) : (
                <Link to="/add" className="btn btn--primary">
                  Добавить слова
                </Link>
              ))}
            <Link to="/" className={`btn${goalProg && !goalProg.done ? '' : ' btn--primary'}`}>
              На главную
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isFwd = current.direction === 'fwd';
  const english = (
    <span className="row" style={{ justifyContent: 'center' }}>
      <span>{note.front}</span>
      {tts && <SpeakButton text={note.front} />}
    </span>
  );

  let question: ReactNode;
  let answer: ReactNode;
  if (isGrammar) {
    question = <Markdown text={note.front} />;
    answer = <Markdown text={note.back} />;
  } else if (isFwd) {
    question = (
      <>
        {english}
        {note.transcription && <div className="flashcard__meta">[{note.transcription}]</div>}
      </>
    );
    answer = note.back;
  } else {
    question = note.back;
    answer = (
      <>
        {english}
        {note.transcription && <div className="flashcard__meta">[{note.transcription}]</div>}
      </>
    );
  }

  return (
    <div className="study">
      {header}
      <div className="study__progress" aria-hidden="true">
        <div style={{ width: `${progress}%` }} />
      </div>

      <div className="card flashcard" onClick={revealed ? undefined : reveal}>
        <span className="badge">
          {isGrammar ? 'Грамматика' : isFwd ? 'EN → RU' : 'RU → EN'}
          {current.state === 0 ? ' · новое' : ''}
        </span>
        <div className="flashcard__front">{question}</div>
        {revealed && (
          <>
            <hr className="flashcard__divider" />
            <div className="flashcard__back">{answer}</div>
            {note.example && <div className="flashcard__meta">{note.example}</div>}
            {note.comment && <div className="flashcard__meta">{note.comment}</div>}
          </>
        )}
      </div>

      {revealed ? (
        <div className="answer-buttons">
          {RATINGS.map((r) => (
            <button
              key={r}
              type="button"
              className={`answer-btn answer-btn--${r}`}
              disabled={busy}
              onClick={() => void rate(r)}
            >
              <span className="answer-btn__label">{RATING_LABELS[r]}</span>
              <span className="answer-btn__ivl">{intervals?.[r]}</span>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--block" onClick={reveal}>
          Показать ответ
        </button>
      )}
      <div className="kbd-hint">Пробел — показать ответ · 1–4 — оценка · Ctrl+Z — отменить</div>
    </div>
  );
}
