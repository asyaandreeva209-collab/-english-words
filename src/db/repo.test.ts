// fake-indexeddb должен подключиться до создания Dexie в schema.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { createDb, db } from './schema';
import {
  CardNotFoundError,
  addNote,
  addNotes,
  createDeck,
  deleteDeck,
  deleteNote,
  directionsFor,
  exportAll,
  getSettings,
  recordReview,
  saveSettings,
  undoReview,
  updateNote,
} from './repo';
import { CardStates } from '../domain/types';

const NOW = new Date(2026, 0, 15, 12).getTime();
const NO_FUZZ = { enableFuzz: false };

beforeEach(async () => {
  await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);
});

describe('directionsFor', () => {
  it('vocab/grammar и createReverse', () => {
    expect(directionsFor('vocab', true)).toEqual(['fwd', 'rev']);
    expect(directionsFor('vocab', false)).toEqual(['fwd']);
    expect(directionsFor('grammar', true)).toEqual(['fwd']);
    expect(directionsFor('grammar', false)).toEqual(['fwd']);
  });
});

describe('addNotes', () => {
  it('vocab + createReverse: fwd и rev для каждой заметки', async () => {
    const deck = await createDeck({ name: 'Words', kind: 'vocab' }, NOW);
    const notes = await addNotes(
      deck.id,
      [
        { front: ' apple ', back: ' яблоко ', comment: '  ' },
        { front: 'dog', back: 'собака', example: 'a dog' },
      ],
      { createReverse: true, now: NOW },
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ front: 'apple', back: 'яблоко', deckId: deck.id });
    expect(notes[0]).not.toHaveProperty('comment');
    expect(notes[1]?.example).toBe('a dog');

    const cards = await db.cards.toArray();
    expect(cards).toHaveLength(4);
    for (const n of notes) {
      const dirs = cards.filter((c) => c.noteId === n.id).map((c) => c.direction).sort();
      expect(dirs).toEqual(['fwd', 'rev']);
    }
    expect(cards.every((c) => c.state === CardStates.New && c.deckId === deck.id)).toBe(true);
    // порядок ввода сохраняется через due (+i мс)
    const n0 = cards.find((c) => c.noteId === notes[0]!.id)!;
    const n1 = cards.find((c) => c.noteId === notes[1]!.id)!;
    expect(n0.due).toBeLessThan(n1.due);
  });

  it('vocab + createReverse=false: только fwd', async () => {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    await addNotes(deck.id, [{ front: 'a', back: 'б' }], { createReverse: false, now: NOW });
    const cards = await db.cards.toArray();
    expect(cards.map((c) => c.direction)).toEqual(['fwd']);
  });

  it('grammar: только fwd даже при createReverse=true', async () => {
    const deck = await createDeck({ name: 'G', kind: 'grammar' }, NOW);
    await addNote(deck.id, { front: 'Present Simple?', back: '**V1**' }, { createReverse: true, now: NOW });
    const cards = await db.cards.toArray();
    expect(cards.map((c) => c.direction)).toEqual(['fwd']);
  });

  it('несуществующая колода — ошибка, ничего не записано', async () => {
    await expect(addNotes('nope', [{ front: 'a', back: 'b' }], { createReverse: true, now: NOW })).rejects.toThrow(
      'Колода не найдена',
    );
    expect(await db.notes.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
  });

  it('обновляет updatedAt колоды', async () => {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    await addNotes(deck.id, [{ front: 'a', back: 'b' }], { createReverse: true, now: NOW + 1000 });
    expect((await db.decks.get(deck.id))?.updatedAt).toBe(NOW + 1000);
  });
});

describe('updateNote', () => {
  it('обрезает пробелы и удаляет пустые поля', async () => {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    const note = await addNote(deck.id, { front: 'a', back: 'b', comment: 'c' }, { createReverse: true, now: NOW });
    await updateNote(note.id, { front: ' x ', back: ' y ', comment: ' ' }, NOW + 5);
    const saved = await db.notes.get(note.id);
    expect(saved).toMatchObject({ front: 'x', back: 'y', updatedAt: NOW + 5 });
    expect(saved?.comment).toBeUndefined();
  });
});

describe('каскадное удаление', () => {
  async function setup() {
    const d1 = await createDeck({ name: 'D1', kind: 'vocab' }, NOW);
    const d2 = await createDeck({ name: 'D2', kind: 'vocab' }, NOW);
    const [n1, n2] = await addNotes(
      d1.id,
      [
        { front: 'a', back: 'а' },
        { front: 'b', back: 'б' },
      ],
      { createReverse: true, now: NOW },
    );
    const [m1] = await addNotes(d2.id, [{ front: 'c', back: 'ц' }], { createReverse: true, now: NOW });
    for (const c of await db.cards.toArray()) {
      await recordReview(c, 3, { mode: 'flash', now: NOW + 1, scheduler: NO_FUZZ });
    }
    return { d1, d2, n1: n1!, n2: n2!, m1: m1! };
  }

  it('deleteNote удаляет заметку, её карточки и логи, не трогая остальное', async () => {
    const { n1, n2 } = await setup();
    const n1Cards = await db.cards.where('noteId').equals(n1.id).primaryKeys();
    await deleteNote(n1.id);

    expect(await db.notes.get(n1.id)).toBeUndefined();
    expect(await db.cards.where('noteId').equals(n1.id).count()).toBe(0);
    expect(await db.reviewLogs.where('cardId').anyOf(n1Cards).count()).toBe(0);

    expect(await db.notes.get(n2.id)).toBeDefined();
    expect(await db.cards.count()).toBe(4);
    expect(await db.reviewLogs.count()).toBe(4);
  });

  it('deleteNote для заметки без карточек/несуществующей не падает', async () => {
    await expect(deleteNote('missing')).resolves.toBeUndefined();
  });

  it('deleteDeck удаляет колоду, заметки, карточки и логи только этой колоды', async () => {
    const { d1, d2 } = await setup();
    await deleteDeck(d1.id);

    expect(await db.decks.get(d1.id)).toBeUndefined();
    expect(await db.notes.where('deckId').equals(d1.id).count()).toBe(0);
    expect(await db.cards.where('deckId').equals(d1.id).count()).toBe(0);
    expect(await db.reviewLogs.where('deckId').equals(d1.id).count()).toBe(0);

    expect(await db.decks.get(d2.id)).toBeDefined();
    expect(await db.notes.count()).toBe(1);
    expect(await db.cards.count()).toBe(2);
    expect(await db.reviewLogs.count()).toBe(2);
  });
});

describe('recordReview / undoReview', () => {
  it('recordReview обновляет карточку и пишет лог', async () => {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    await addNote(deck.id, { front: 'a', back: 'б' }, { createReverse: false, now: NOW });
    const [card] = await db.cards.toArray();
    const res = await recordReview(card!, 1, { mode: 'type', now: NOW + 1000, elapsedMs: 4200, scheduler: NO_FUZZ });

    expect(res.previous).toEqual(card);
    expect(res.card.state).toBe(CardStates.Learning);
    expect(res.card.updatedAt).toBe(NOW + 1000);
    expect(await db.cards.get(card!.id)).toEqual(res.card);

    const logs = await db.reviewLogs.toArray();
    expect(logs).toEqual([
      {
        id: res.log.id,
        cardId: card!.id,
        deckId: deck.id,
        rating: 1,
        mode: 'type',
        stateBefore: CardStates.New,
        reviewedAt: NOW + 1000,
        elapsedMs: 4200,
      },
    ]);
  });

  it('undoReview восстанавливает состояние карточки и удаляет лог', async () => {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    await addNote(deck.id, { front: 'a', back: 'б' }, { createReverse: false, now: NOW });
    const [card] = await db.cards.toArray();
    const r1 = await recordReview(card!, 3, { mode: 'flash', now: NOW + 1, scheduler: NO_FUZZ });
    const r2 = await recordReview(r1.card, 3, { mode: 'flash', now: NOW + 11 * 60_000, scheduler: NO_FUZZ });
    expect(await db.reviewLogs.count()).toBe(2);

    await undoReview(r2);
    expect(await db.cards.get(card!.id)).toEqual(r1.card);
    expect((await db.reviewLogs.toArray()).map((l) => l.id)).toEqual([r1.log.id]);

    await undoReview(r1);
    expect(await db.cards.get(card!.id)).toEqual(card);
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('recordReview / undoReview: удалённые карточки', () => {
  async function oneCard() {
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    const note = await addNote(deck.id, { front: 'a', back: 'б' }, { createReverse: false, now: NOW });
    const [card] = await db.cards.toArray();
    return { note, card: card! };
  }

  it('recordReview по удалённой карточке: ошибка, карточка не воскресает, лога нет', async () => {
    const { note, card } = await oneCard();
    await deleteNote(note.id);
    await expect(recordReview(card, 3, { mode: 'flash', now: NOW + 1, scheduler: NO_FUZZ })).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('undoReview после удаления карточки: ошибка, ничего не восстановлено', async () => {
    const { note, card } = await oneCard();
    const res = await recordReview(card, 3, { mode: 'flash', now: NOW + 1, scheduler: NO_FUZZ });
    await deleteNote(note.id);
    await expect(undoReview(res)).rejects.toBeInstanceOf(CardNotFoundError);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('настройки и экспорт', () => {
  it('getSettings возвращает дефолты, saveSettings сохраняет патч', async () => {
    expect((await getSettings()).newPerDay).toBe(10);
    await saveSettings({ newPerDay: 6, claudeApiKey: 'sk-secret' });
    const s = await getSettings();
    expect(s).toMatchObject({ id: 'main', newPerDay: 6, dayStartsAtHour: 4 });
  });

  it('параллельные saveSettings не затирают друг друга', async () => {
    await Promise.all([saveSettings({ newPerDay: 7 }), saveSettings({ theme: 'dark' }), saveSettings({ ttsEnabled: false })]);
    expect(await getSettings()).toMatchObject({ newPerDay: 7, theme: 'dark', ttsEnabled: false });
  });

  it('exportAll включает данные и не включает API-ключ', async () => {
    await saveSettings({ claudeApiKey: 'sk-secret' });
    const deck = await createDeck({ name: 'W', kind: 'vocab' }, NOW);
    await addNote(deck.id, { front: 'a', back: 'б' }, { createReverse: true, now: NOW });
    const b = await exportAll(NOW);
    expect(b.decks).toHaveLength(1);
    expect(b.notes).toHaveLength(1);
    expect(b.cards).toHaveLength(2);
    expect(b.settings).not.toHaveProperty('claudeApiKey');
    expect(JSON.stringify(b)).not.toContain('sk-secret');
  });
});

describe('миграция БД v1 → v2 (лимит в словах)', () => {
  it('переводит лимиты из карточек в слова', async () => {
    const name = `mig-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ decks: 'id, name', notes: 'id', cards: 'id', reviewLogs: 'id', settings: 'id' });
    await v1.table('settings').put({ id: 'main', newPerDay: 20, createReverse: true });
    await v1.table('decks').bulkPut([
      { id: 'v', name: 'v', kind: 'vocab', newPerDay: 7, createdAt: 0, updatedAt: 0 },
      { id: 'g', name: 'g', kind: 'grammar', newPerDay: 4, createdAt: 0, updatedAt: 0 },
      { id: 'n', name: 'n', kind: 'vocab', createdAt: 0, updatedAt: 0 },
    ]);
    v1.close();

    const v2 = createDb(name);
    expect((await v2.settings.get('main'))?.newPerDay).toBe(10);
    expect((await v2.settings.get('main'))?.claudeModel).toBe('claude-opus-5-5');
    expect((await v2.decks.get('v'))?.newPerDay).toBe(4);
    expect((await v2.decks.get('g'))?.newPerDay).toBe(4);
    expect((await v2.decks.get('n'))?.newPerDay).toBeUndefined();
    v2.close();
  });
});

describe('миграции БД: лимит 0 и модель Claude', () => {
  it('v1 → текущая: лимит 0 остаётся 0 (без новых слов)', async () => {
    const name = `mig0-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ decks: 'id, name', notes: 'id', cards: 'id', reviewLogs: 'id', settings: 'id' });
    await v1.table('settings').put({ id: 'main', newPerDay: 0, createReverse: true });
    await v1.table('decks').put({ id: 'z', name: 'z', kind: 'vocab', newPerDay: 0, createdAt: 0, updatedAt: 0 });
    v1.close();

    const cur = createDb(name);
    expect((await cur.settings.get('main'))?.newPerDay).toBe(0);
    expect((await cur.decks.get('z'))?.newPerDay).toBe(0);
    cur.close();
  });

  it('v2 → v3: старая заглушка claude-sonnet-4-5 заменяется на модель по умолчанию, остальное не трогается', async () => {
    const name = `mig3-${Date.now()}`;
    const stores = {
      decks: 'id, name',
      notes: 'id, deckId, front',
      cards: 'id, noteId, deckId, due, state, [deckId+state], [deckId+due]',
      reviewLogs: 'id, cardId, reviewedAt, deckId',
      settings: 'id',
    };
    const v2 = new Dexie(name);
    v2.version(1).stores(stores);
    v2.version(2).stores(stores);
    await v2.table('settings').put({ id: 'main', newPerDay: 8, claudeModel: 'claude-sonnet-4-5', claudeApiKey: 'k' });
    v2.close();

    const v3 = createDb(name);
    expect(await v3.settings.get('main')).toMatchObject({ newPerDay: 8, claudeModel: 'claude-opus-5-5', claudeApiKey: 'k' });
    v3.close();
  });

  it('v2 → v3: поддерживаемая модель сохраняется', async () => {
    const name = `mig3b-${Date.now()}`;
    const v2 = new Dexie(name);
    v2.version(2).stores({ decks: 'id, name', notes: 'id', cards: 'id', reviewLogs: 'id', settings: 'id' });
    await v2.table('settings').put({ id: 'main', newPerDay: 8, claudeModel: 'claude-haiku-4-5' });
    v2.close();

    const v3 = createDb(name);
    expect((await v3.settings.get('main'))?.claudeModel).toBe('claude-haiku-4-5');
    v3.close();
  });

  it('getSettings: уровень по умолчанию B1, неизвестная модель → по умолчанию', async () => {
    expect(await getSettings()).toMatchObject({ englishLevel: 'B1', claudeModel: 'claude-opus-5-5' });
    await db.settings.put({ ...(await getSettings()), claudeModel: 'claude-sonnet-4-5' as never, englishLevel: 'C1' });
    expect(await getSettings()).toMatchObject({ englishLevel: 'C1', claudeModel: 'claude-opus-5-5' });
  });
});
