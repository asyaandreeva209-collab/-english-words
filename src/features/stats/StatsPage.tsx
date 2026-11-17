// Статистика: серия дней, рекорд и календарь активности за 8 недель. Остальное (этап 4) — позже.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { withDefaults } from '../../db/repo';
import { loadAllDays } from '../../db/streak';
import { bestStreak, computeStreak, dayIndex, dayIndexToStart, goalFromSettings, heatmap } from '../../domain/streak';
import { daysInRow, plural } from '../../ui/plural';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKS = 8;

export function StatsPage() {
  const data = useLiveQuery(async () => {
    const settings = withDefaults(await db.settings.get('main'));
    const days = await loadAllDays(settings);
    return { settings, days, today: dayIndex(Date.now(), settings.dayStartsAtHour) };
  }, []);

  if (!data) return null;
  const { settings, days, today } = data;
  const goal = goalFromSettings(settings);

  return (
    <div>
      <h1>Статистика</h1>
      {!goal ? (
        <div className="card empty">
          <p style={{ margin: 0 }}>Дневная цель выключена — серия дней не считается. Включить её можно в настройках.</p>
        </div>
      ) : (
        <StreakStats days={days} today={today} goal={goal} dayStartsAtHour={settings.dayStartsAtHour} />
      )}
      <div className="card empty">
        <p style={{ margin: 0 }}>Скоро здесь появятся выученные слова и прогноз повторений.</p>
      </div>
    </div>
  );
}

function StreakStats({
  days,
  today,
  goal,
  dayStartsAtHour,
}: {
  days: Parameters<typeof heatmap>[0];
  today: number;
  goal: Parameters<typeof heatmap>[1];
  dayStartsAtHour: number;
}) {
  const streak = computeStreak(days, goal, today);
  const best = bestStreak(days, goal, today);
  const cells = heatmap(days, goal, today, WEEKS);
  // Колонка — неделя, строка — день недели
  const fmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

  return (
    <div className="card stack">
      <div className="counts" style={{ gridTemplateColumns: 'repeat(2, 1fr)', margin: 0 }}>
        <div className="count">
          <div className="count__num">🔥 {streak.current}</div>
          <div className="count__label">{plural(streak.current, 'день', 'дня', 'дней')} подряд</div>
        </div>
        <div className="count">
          <div className="count__num">{best}</div>
          <div className="count__label">рекорд, {plural(best, 'день', 'дня', 'дней')}</div>
        </div>
      </div>
      {streak.atRisk && <p className="muted small" style={{ margin: 0 }}>Выполните цель сегодня, чтобы не потерять серию ({daysInRow(streak.current)}).</p>}
      <div className="heatmap-wrap">
        <div className="heatmap__labels" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="heatmap" role="img" aria-label={`Активность за ${WEEKS} недель`}>
          {cells.map((c) => {
            // Дата для подписи — середина учебного дня, чтобы не зависеть от часа его начала
            const date = fmt.format(dayIndexToStart(c.day, dayStartsAtHour) + 12 * 3_600_000);
            const title = c.future
              ? date
              : `${date}: ${c.cards} ${plural(c.cards, 'ответ', 'ответа', 'ответов')}, ${c.minutes} мин` +
                (c.done ? ' — цель выполнена' : c.frozen ? ' — пропуск прощён' : '');
            const cls = c.future
              ? ' heatmap__cell--future'
              : c.frozen
                ? ' heatmap__cell--frozen'
                : ` heatmap__cell--l${c.level}`;
            return (
              <span
                key={c.day}
                className={`heatmap__cell${cls}${c.day === today ? ' heatmap__cell--today' : ''}`}
                title={title}
              />
            );
          })}
        </div>
      </div>
      <div className="heatmap__legend muted small">
        <span>меньше</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heatmap__cell heatmap__cell--l${l}`} />
        ))}
        <span>больше</span>
        <span className="heatmap__cell heatmap__cell--frozen" style={{ marginLeft: 8 }} />
        <span>прощённый пропуск</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Один пропуск на любые 7 дней прощается, если накануне цель была выполнена. Два пропуска подряд обрывают серию.
      </p>
    </div>
  );
}
