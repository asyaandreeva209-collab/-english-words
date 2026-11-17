import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { createDeck } from '../../db/repo';
import { useDecks } from '../../db/hooks';
import type { Deck, DeckKind } from '../../domain/types';
import { useToast } from '../../ui/Toast';
import { plural } from '../../ui/plural';
import { KIND_LABELS } from './labels';

export function DecksPage() {
  const decks = useDecks();
  const noteCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.notes.each((n) => counts.set(n.deckId, (counts.get(n.deckId) ?? 0) + 1));
    return counts;
  }, []);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeckKind>('vocab');
  const toast = useToast();

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createDeck({ name, kind });
    setName('');
    toast('Колода создана');
  };

  if (!decks) return null;
  const active = decks.filter((d) => !d.archived);
  const archived = decks.filter((d) => d.archived);

  const renderDeck = (d: Deck) => {
    const n = noteCounts?.get(d.id) ?? 0;
    return (
      <li key={d.id}>
        <Link to={`/decks/${d.id}`} className="deck-link list__main">
          <div className="list__title">{d.name}</div>
          <div className="muted small">
            {KIND_LABELS[d.kind]} · {n} {d.kind === 'vocab' ? plural(n, 'слово', 'слова', 'слов') : plural(n, 'карточка', 'карточки', 'карточек')}
          </div>
        </Link>
        <Link to={`/add?deck=${encodeURIComponent(d.id)}`} className="btn btn--sm">
          Добавить
        </Link>
      </li>
    );
  };

  return (
    <div>
      <h1>Колоды</h1>

      <form className="card stack" onSubmit={(e) => void onCreate(e)}>
        <h2 style={{ margin: 0 }}>Новая колода</h2>
        <input
          type="text"
          placeholder="Название, например «Словарик, стр. 1–5»"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Название колоды"
        />
        <div className="row row--between">
          <div className="segmented" role="group" aria-label="Тип колоды">
            {(Object.keys(KIND_LABELS) as DeckKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
            Создать
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {kind === 'vocab'
            ? 'Слово → перевод. Можно учить в обе стороны: EN→RU и RU→EN.'
            : 'Вопрос → ответ. В ответе можно использовать **жирный**, *курсив* и списки «- ».'}
        </p>
      </form>

      {active.length > 0 ? (
        <div className="card">
          <ul className="list">{active.map(renderDeck)}</ul>
        </div>
      ) : (
        <p className="empty">Колод пока нет.</p>
      )}

      {archived.length > 0 && (
        <div className="card">
          <h2>Архив</h2>
          <p className="muted small">Карточки из архивных колод не показываются на повторении.</p>
          <ul className="list">{archived.map(renderDeck)}</ul>
        </div>
      )}
    </div>
  );
}
