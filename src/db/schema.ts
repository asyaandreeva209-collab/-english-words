// Dexie: таблицы и версии схемы. Новые версии добавлять ниже, не меняя старые.
import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_CLAUDE_MODEL, isClaudeModel, type Card, type Deck, type Note, type ReviewLog, type Settings } from '../domain/types';
import { legacyCardsLimitToWords } from '../domain/limits';

export type AppDB = Dexie & {
  decks: EntityTable<Deck, 'id'>;
  notes: EntityTable<Note, 'id'>;
  cards: EntityTable<Card, 'id'>;
  reviewLogs: EntityTable<ReviewLog, 'id'>;
  settings: EntityTable<Settings, 'id'>;
};

export const DB_NAME = 'english-words';

const STORES_V1 = {
  decks: 'id, name',
  notes: 'id, deckId, front',
  cards: 'id, noteId, deckId, due, state, [deckId+state], [deckId+due]',
  reviewLogs: 'id, cardId, reviewedAt, deckId',
  settings: 'id',
};

export function createDb(name = DB_NAME): AppDB {
  const db = new Dexie(name) as AppDB;
  db.version(1).stores(STORES_V1);
  // v2: лимит новых (settings.newPerDay, decks.newPerDay) хранится в словах, а не в карточках
  db.version(2)
    .stores(STORES_V1)
    .upgrade(async (tx) => {
      const settings = await tx.table<Settings, string>('settings').get('main');
      const createReverse = settings?.createReverse ?? true;
      if (settings && typeof settings.newPerDay === 'number') {
        await tx
          .table<Settings, string>('settings')
          .update('main', { newPerDay: legacyCardsLimitToWords(settings.newPerDay, createReverse) });
      }
      await tx
        .table<Deck, string>('decks')
        .toCollection()
        .modify((d) => {
          if (typeof d.newPerDay !== 'number') return;
          // Для грамматики одна карточка = одно слово, лимит и раньше был «в словах»
          d.newPerDay = legacyCardsLimitToWords(d.newPerDay, d.kind === 'vocab' && createReverse);
        });
    });
  // v3: заглушка модели 'claude-sonnet-4-5' и прочие неизвестные id → модель по умолчанию
  db.version(3)
    .stores(STORES_V1)
    .upgrade(async (tx) => {
      const settings = await tx.table<Settings, string>('settings').get('main');
      if (settings && !isClaudeModel(settings.claudeModel)) {
        await tx.table<Settings, string>('settings').update('main', { claudeModel: DEFAULT_CLAUDE_MODEL });
      }
    });
  return db;
}

export const db = createDb();
