import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { saveSettings } from '../../db/repo';
import { shouldRemindBackup } from '../../domain/backupReminder';
import { loadQueue, MORE_NEW } from '../study/loadQueue';
import { useStreak } from '../../db/hooks';
import { goalProgress } from '../../domain/streak';
import { StreakCard } from './StreakCard';
import type { Card } from '../../domain/types';
import { plural } from '../../ui/plural';

/** Обновлять «сейчас» раз в минуту, чтобы обучающие карточки «созревали» без перезагрузки. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** «Позже» в напоминании о копии — не напоминать 3 суток. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

interface DeckCounts {
  learning: number;
  review: number;
  fresh: number;
}

function countByDeck(cards: Card[], key: keyof DeckCounts, into: Map<string, DeckCounts>): void {
  for (const c of cards) {
    let v = into.get(c.deckId);
    if (!v) into.set(c.deckId, (v = { learning: 0, review: 0, fresh: 0 }));
    v[key]++;
  }
}

export function TodayPage() {
  const now = useMinuteTick();
  const data = useLiveQuery(async () => {
    const [q, decks, noteCount] = await Promise.all([loadQueue(now), db.decks.toArray(), db.notes.count()]);
    // Очередь пуста — есть ли новые слова сверх лимита (для «Ещё 5 новых слов»)
    const moreAvailable = q.queue.length === 0 && (await loadQueue(now, undefined, MORE_NEW)).fresh.length > 0;
    return { q, decks, noteCount, moreAvailable };
  }, [now]);
  const streak = useStreak(now);

  if (!data) return null;
  const { q, decks, noteCount, moreAvailable } = data;
  const goalNotDone = !!streak?.goal && !goalProgress(streak.days.get(streak.today), streak.goal).done;
  const activeDecks = decks.filter((d) => !d.archived).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const byDeck = new Map<string, DeckCounts>();
  countByDeck(q.learning, 'learning', byDeck);
  countByDeck(q.review, 'review', byDeck);
  countByDeck(q.fresh, 'fresh', byDeck);

  const total = q.queue.length;
  const reverse = q.settings.createReverse;
  const limitWords = q.settings.newPerDay;
  const remindBackup = shouldRemindBackup({
    noteCount,
    lastBackupAt: q.settings.lastBackupAt,
    snoozeUntil: q.settings.backupReminderSnoozeUntil,
    now,
  });

  return (
    <div>
      <h1>Сегодня</h1>

      {decks.length === 0 ? (
        <div className="card">
          <h2>Добро пожаловать!</h2>
          <p>Создайте колоду и добавьте в неё слова из своего словарика — по одному или сразу списком.</p>
          <Link to="/decks" className="btn btn--primary">
            Создать колоду
          </Link>
        </div>
      ) : (
        <>
          {remindBackup && (
            <div className="notice">
              <p style={{ margin: '0 0 8px' }}>Давно не было резервной копии — данные хранятся только в этом браузере</p>
              <div className="row">
                <Link to="/settings" className="btn btn--sm btn--primary">
                  Сделать копию
                </Link>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void saveSettings({ backupReminderSnoozeUntil: Date.now() + SNOOZE_MS })}
                >
                  Позже
                </button>
              </div>
            </div>
          )}
          <div className="card">
            {streak && <StreakCard data={streak} />}
            <div className="counts">
              <div className="count">
                <div className="count__num">{q.fresh.length}</div>
                <div className="count__label">новых</div>
              </div>
              <div className="count">
                <div className="count__num">{q.learning.length}</div>
                <div className="count__label">в изучении</div>
              </div>
              <div className="count">
                <div className="count__num">{q.review.length}</div>
                <div className="count__label">повторить</div>
              </div>
            </div>
            {total > 0 ? (
              <Link to="/study" className="btn btn--primary btn--block">
                Начать ({total})
              </Link>
            ) : noteCount > 0 && goalNotDone ? (
              moreAvailable ? (
                <Link to={`/study?more=${MORE_NEW}`} className="btn btn--primary btn--block">
                  Ещё {MORE_NEW} новых слов
                </Link>
              ) : (
                <Link to="/add" className="btn btn--primary btn--block">
                  Добавить слова
                </Link>
              )
            ) : (
              <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
                {noteCount === 0
                  ? 'Пока нет слов. Добавьте их в разделе «Добавить».'
                  : 'На сегодня всё! Возвращайтесь завтра.'}
              </p>
            )}
          </div>

          <div className="card">
            <h2>Колоды</h2>
            <ul className="list">
              {activeDecks.map((d) => {
                const c = byDeck.get(d.id) ?? { learning: 0, review: 0, fresh: 0 };
                const n = c.learning + c.review + c.fresh;
                return (
                  <li key={d.id}>
                    <div className="list__main">
                      <Link to={`/decks/${d.id}`} className="deck-link">
                        <div className="list__title">{d.name}</div>
                      </Link>
                      <div className="row small">
                        <span className="badge badge--new">новых {c.fresh}</span>
                        <span className="badge badge--learn">изучаю {c.learning}</span>
                        <span className="badge badge--review">повторить {c.review}</span>
                      </div>
                    </div>
                    <Link
                      to={`/study?deck=${encodeURIComponent(d.id)}`}
                      className={`btn btn--sm${n > 0 ? ' btn--primary' : ''}`}
                      aria-disabled={n === 0}
                    >
                      Учить
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <details className="card">
        <summary>
          <strong>Почему новые слова выдаются понемногу?</strong>
        </summary>
        <p style={{ marginTop: 12 }}>
          Каждое новое слово через несколько дней вернётся на повторение — и ещё много раз потом. Если взять
          сразу 100 слов, через неделю придётся каждый день повторять сотни карточек, и учёба превратится в
          рутину.
        </p>
        <p>
          Сейчас лимит — <strong>{limitWords}</strong> {plural(limitWords, 'новое слово', 'новых слова', 'новых слов')}{' '}
          в день (сегодня введено: {q.newIntroducedToday}).
          {reverse
            ? ' Каждое слово учится в обе стороны: сначала EN→RU, а обратная карточка RU→EN придёт на следующий день — она в лимит не входит.'
            : ''}{' '}
          Лимит можно изменить в настройках.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Повторения не ограничены: алгоритм FSRS показывает слово как раз тогда, когда вы начинаете его
          забывать.
        </p>
      </details>
    </div>
  );
}
