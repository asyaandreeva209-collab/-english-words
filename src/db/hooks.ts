// React-хуки поверх Dexie (живые запросы).
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './schema';
import { withDefaults } from './repo';
import { loadStreakData, type StreakData } from './streak';
import { computeStreak, type StreakInfo } from '../domain/streak';
import type { Deck, Settings } from '../domain/types';

/** Настройки с дефолтами; undefined — пока грузятся (чтобы не мелькали значения по умолчанию). */
export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => withDefaults(await db.settings.get('main')), []);
}

/** Колоды по имени; undefined — пока грузится. */
export function useDecks(includeArchived = true): Deck[] | undefined {
  return useLiveQuery(async () => {
    const decks = await db.decks.orderBy('name').toArray();
    return includeArchived ? decks : decks.filter((d) => !d.archived);
  }, [includeArchived]);
}

/** Лицевые стороны слов колоды (для подсветки дубликатов); undefined — пока грузится. */
export function useDeckFronts(deckId: string): string[] | undefined {
  return useLiveQuery(async () => {
    const notes = await db.notes.where('deckId').equals(deckId).toArray();
    return notes.map((n) => n.front);
  }, [deckId]);
}

export interface StreakState extends StreakData {
  /** null — цель выключена. */
  streak: StreakInfo | null;
}

/** Серия дней и прогресс цели; пересчитывается после каждой оценки и отмены. undefined — пока грузится. */
export function useStreak(now: number): StreakState | undefined {
  return useLiveQuery(async () => {
    const data = await loadStreakData(now, withDefaults(await db.settings.get('main')));
    return { ...data, streak: data.goal ? computeStreak(data.days, data.goal, data.today) : null };
  }, [now]);
}
