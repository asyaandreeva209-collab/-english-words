import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { deleteDeck, deleteNote, updateDeck, updateNote, type NoteInput } from '../../db/repo';
import { useSettings } from '../../db/hooks';
import { MAX_LIMIT, parseLimit } from '../../domain/limits';
import { normalizeFront } from '../../domain/parseList';
import type { Deck, Note } from '../../domain/types';
import { NoteFields } from '../add/NoteFields';
import { IconBack, IconEdit, IconTrash } from '../../ui/icons';
import { Markdown } from '../../ui/Markdown';
import { Modal } from '../../ui/Modal';
import { SpeakButton } from '../../ui/SpeakButton';
import { useToast } from '../../ui/Toast';
import { KIND_LABELS } from './labels';

export function DeckPage() {
  const { deckId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();

  // null — колоды нет, undefined — ещё грузится
  const deck = useLiveQuery(async () => (await db.decks.get(deckId)) ?? null, [deckId]);
  const notes = useLiveQuery(() => db.notes.where('deckId').equals(deckId).toArray(), [deckId]);

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [editingDeck, setEditingDeck] = useState(false);

  if (deck === undefined || notes === undefined) return null;
  if (deck === null) {
    return <p className="empty">Колода не найдена.</p>;
  }

  const q = normalizeFront(search);
  const filtered = notes
    .filter((n) => !q || normalizeFront(`${n.front} ${n.back}`).includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  const onDeleteNote = async (n: Note) => {
    if (!window.confirm(`Удалить «${n.front}»? Прогресс по этому слову тоже удалится.`)) return;
    await deleteNote(n.id);
    toast('Удалено');
  };

  const onDeleteDeck = async () => {
    if (!window.confirm(`Удалить колоду «${deck.name}» со всеми словами (${notes.length}) и прогрессом? Это нельзя отменить.`)) {
      return;
    }
    await deleteDeck(deck.id);
    toast('Колода удалена');
    navigate('/decks');
  };

  const isVocab = deck.kind === 'vocab';

  return (
    <div>
      <Link to="/decks" className="btn btn--ghost btn--sm">
        <IconBack /> Колоды
      </Link>
      <div className="row row--between" style={{ margin: '8px 0 16px' }}>
        <div className="grow">
          <h1 style={{ marginBottom: 4 }}>{deck.name}</h1>
          <div className="muted small">
            {KIND_LABELS[deck.kind]}
            {deck.archived ? ' · в архиве' : ''}
            {deck.description ? ` · ${deck.description}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => setEditingDeck(true)}>
          Изменить
        </button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link to={`/study?deck=${encodeURIComponent(deck.id)}`} className="btn btn--primary">
          Учить
        </Link>
        <Link to={`/add?deck=${encodeURIComponent(deck.id)}`} className="btn">
          Добавить {isVocab ? 'слова' : 'карточки'}
        </Link>
      </div>

      <div className="card">
        <input
          type="search"
          placeholder="Поиск"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Поиск по колоде"
        />
        {filtered.length === 0 ? (
          <p className="empty">{notes.length === 0 ? 'В колоде пока пусто.' : 'Ничего не найдено.'}</p>
        ) : (
          <ul className="list">
            {filtered.map((n) => (
              <li key={n.id}>
                <div className="list__main">
                  {isVocab ? (
                    <>
                      <div className="list__title">
                        {n.front}
                        {n.transcription && <span className="muted small"> [{n.transcription}]</span>}
                      </div>
                      <div className="muted">{n.back}</div>
                    </>
                  ) : (
                    <>
                      <div className="list__title">{n.front}</div>
                      <Markdown text={n.back} className="muted small" />
                    </>
                  )}
                </div>
                {isVocab && settings?.ttsEnabled && <SpeakButton text={n.front} />}
                <button
                  type="button"
                  className="btn btn--ghost icon-btn"
                  aria-label="Изменить"
                  title="Изменить"
                  onClick={() => setEditing(n)}
                >
                  <IconEdit />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--danger icon-btn"
                  aria-label="Удалить"
                  title="Удалить"
                  onClick={() => void onDeleteNote(n)}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          Всего: {notes.length}
        </p>
      </div>

      {editing && (
        <EditNoteModal
          note={editing}
          deck={deck}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Сохранено');
          }}
        />
      )}
      {editingDeck && (
        <EditDeckModal
          deck={deck}
          globalLimit={settings?.newPerDay}
          onClose={() => setEditingDeck(false)}
          onDelete={() => void onDeleteDeck()}
        />
      )}
    </div>
  );
}

function EditNoteModal({ note, deck, onClose, onSaved }: { note: Note; deck: Deck; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<NoteInput>({
    front: note.front,
    back: note.back,
    example: note.example,
    comment: note.comment,
    transcription: note.transcription,
  });
  const valid = value.front.trim() !== '' && value.back.trim() !== '';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    await updateNote(note.id, value);
    onSaved();
  };

  return (
    <Modal title="Редактирование" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void onSubmit(e)}>
        <NoteFields kind={deck.kind} value={value} onChange={setValue} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!valid}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditDeckModal({
  deck,
  globalLimit,
  onClose,
  onDelete,
}: {
  deck: Deck;
  globalLimit: number | undefined;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? '');
  // Лимит колоды — в словах; строка правится локально, проверяется при сохранении
  const [limit, setLimit] = useState(deck.newPerDay !== undefined ? String(deck.newPerDay) : '');
  const [archived, setArchived] = useState(!!deck.archived);
  const limitInvalid = limit.trim() !== '' && parseLimit(limit) === null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const n = limit.trim() === '' ? undefined : parseLimit(limit);
    if (n === null) return;
    // undefined в update() удаляет поле — колода возвращается к общему лимиту
    await updateDeck(deck.id, {
      name: name.trim(),
      description: description.trim() || undefined,
      newPerDay: n,
      archived,
    });
    onClose();
  };

  return (
    <Modal title="Колода" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          Название
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Описание
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Новых {deck.kind === 'vocab' ? 'слов' : 'карточек'} в день для этой колоды (пусто — общий лимит, 0 = без новых)
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
        {limitInvalid ? (
          <div className="error-text">Введите целое число от 0 до {MAX_LIMIT} или оставьте поле пустым</div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Лимит колоды не может превысить общий
            {globalLimit !== undefined ? ` (сейчас ${globalLimit} в день)` : ''}: если указать больше, действует общий.
          </p>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          <span>В архиве (не показывать на повторении)</span>
        </label>
        <div className="row row--between">
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            Удалить колоду
          </button>
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim() || limitInvalid}>
              Сохранить
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
