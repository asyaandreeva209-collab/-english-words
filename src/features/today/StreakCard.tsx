// Серия дней и дневная цель на «Сегодня»: кольцо прогресса, подпись и точки текущей недели.
import type { StreakState } from '../../db/hooks';
import { goalProgress, heatmap } from '../../domain/streak';
import { daysInRow, plural } from '../../ui/plural';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const R = 26;
const CIRC = 2 * Math.PI * R;

export function StreakCard({ data }: { data: StreakState }) {
  const { goal, streak, days, today } = data;
  if (!goal || !streak) return null;
  const p = goalProgress(days.get(today), goal);
  const ratio = Math.min(1, p.ratio);

  const parts: string[] = [];
  if (goal.cards > 0) parts.push(`${p.cards} из ${goal.cards} ${plural(goal.cards, 'ответа', 'ответов', 'ответов')}`);
  if (goal.minutes > 0) parts.push(`${Math.floor(p.minutes)} из ${goal.minutes} мин`);

  const week = heatmap(days, goal, today, 1);

  return (
    <div className="streak">
      <div className="streak__main">
        <div className="streak__ring" role="img" aria-label={`Цель на сегодня: ${Math.round(ratio * 100)}%`}>
          <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
            <circle cx="32" cy="32" r={R} className="streak__track" />
            <circle
              cx="32"
              cy="32"
              r={R}
              className={`streak__bar${p.done ? ' streak__bar--done' : ''}`}
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - ratio)}
            />
          </svg>
          <span className="streak__num">
            <span aria-hidden="true">🔥</span>
            {streak.current}
          </span>
        </div>
        <div className="streak__info">
          <div className="streak__title">{daysInRow(streak.current)}</div>
          <div className="small">{parts.join(' · ')}</div>
          {p.done ? (
            <div className="small streak__ok">Цель на сегодня выполнена ✓</div>
          ) : streak.atRisk ? (
            <div className="small muted">Выполните цель, чтобы не потерять серию</div>
          ) : null}
        </div>
      </div>
      <div className="week-dots">
        {week.map((c, i) => (
          <div key={c.day} className="week-dots__day">
            <span
              className={`week-dots__dot${c.done ? ' week-dots__dot--done' : ''}${c.frozen ? ' week-dots__dot--frozen' : ''}${c.day === today ? ' week-dots__dot--today' : ''}`}
              title={c.done ? 'Цель выполнена' : c.frozen ? 'Пропуск прощён' : undefined}
            >
              {c.done ? '✓' : c.frozen ? '❄️' : ''}
            </span>
            <span className="week-dots__label">{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
