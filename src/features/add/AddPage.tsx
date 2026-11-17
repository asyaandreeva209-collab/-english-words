import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addNote, addNotes, type NoteInput } from '../../db/repo';
import { useDeckFronts, useDecks, useSettings } from '../../db/hooks';
import { findDuplicates, parseList } from '../../domain/parseList';
import type { Deck } from '../../domain/types';
import { useToast } from '../../ui/Toast';
import { plural } from '../../ui/plural';
import { AiImport } from './AiImport';
import { NoteFields } from './NoteFields';
import { PreviewTable, rowIsValid, type PreviewRow } from './PreviewTable';

type Tab = 'single' | 'bulk' | 'ai';

const EMPTY: NoteInput = { front: '', back: '' };
const LAST_DECK_KEY = 'lastDeckId';

export function AddPage() {
  const decks = useDecks(false);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('single');

  const deckId = params.get('deck') ?? localStorage.getItem(LAST_DECK_KEY) ?? '';
  const deck = decks?.find((d) => d.id === deckId) ?? decks?.[0];

  useEffect(() => {
    if (deck) localStorage.setItem(LAST_DECK_KEY, deck.id);
  }, [deck]);

  if (!decks) return null;
  if (!deck) {
    return (
      <div>
        <h1>Добавить</h1>
        <div className="card">
          <p>Сначала создайте колоду.</p>
          <Link to="/decks" className="btn btn--primary">
            К колодам
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Добавить</h1>
      <div className="card stack">
        <label className="field">
          Колода
          <select value={deck.id} onChange={(e) => setParams({ deck: e.target.value }, { replace: true })}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Способ добавления">
          <button type="button" aria-pressed={tab === 'single'} onClick={() => setTab('single')}>
            По одному
          </button>
          <button type="button" aria-pressed={tab === 'bulk'} onClick={() => setTab('bulk')}>
            Списком
          </button>
          <button type="button" aria-pressed={tab === 'ai'} onClick={() => setTab('ai')}>
            Из фото / текста
          </button>
        </div>
      </div>

      {tab === 'single' && <SingleAdd key={deck.id} deck={deck} />}
      {tab === 'bulk' && <BulkAdd key={deck.id} deck={deck} />}
      {/* ИИ-импорт остаётся смонтированным: результат и идущий запрос не теряются при смене вкладки */}
      <div hidden={tab !== 'ai'}>
        <AiImport deck={deck} active={tab === 'ai'} />
      </div>
    </div>
  );
}

function SingleAdd({ deck }: { deck: Deck }) {
  const settings = useSettings();
  const toast = useToast();
  const [value, setValue] = useState<NoteInput>(EMPTY);
  const [count, setCount] = useState(0);
  const frontEl = useRef<HTMLElement | null>(null);
  const fronts = useDeckFronts(deck.id);

  const isDup = useMemo(
    () => !!value.front.trim() && !!fronts && findDuplicates([value], fronts).size > 0,
    [value, fronts],
  );
  const valid = value.front.trim() !== '' && value.back.trim() !== '';

  // Синхронный флаг: состояние React не успевает обновиться между двумя быстрыми Enter
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    // Очищаем форму до await: следующее слово можно набирать, пока сохраняется текущее
    const saved = value;
    setValue(EMPTY);
    frontEl.current?.focus();
    try {
      await addNote(deck.id, saved, { createReverse: settings.createReverse });
      setCount((c) => c + 1);
      toast(`Добавлено: ${saved.front.trim()}`);
    } catch {
      // Возвращаем слово в форму, если пользователь ещё не начал вводить новое
      setValue((v) => (v === EMPTY ? saved : v));
      toast('Не удалось сохранить слово');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void onSubmit(e)}>
      <NoteFields kind={deck.kind} value={value} onChange={setValue} frontRef={(el) => {
          frontEl.current = el;
        }} />
      {isDup && <div className="small" style={{ color: 'var(--warning)' }}>Такое слово уже есть в этой колоде</div>}
      <div className="row row--between">
        <span className="muted small">
          {deck.kind === 'vocab' ? 'Enter — сохранить и перейти к следующему' : ''}
          {count > 0 ? ` · добавлено: ${count}` : ''}
        </span>
        <button type="submit" className="btn btn--primary" disabled={!valid || saving || !settings}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

let rowKey = 0;

function BulkAdd({ deck }: { deck: Deck }) {
  const settings = useSettings();
  const toast = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const fronts = useDeckFronts(deck.id);
  const isVocab = deck.kind === 'vocab';

  const onParse = () => {
    const parsed = parseList(text);
    const dups = findDuplicates(parsed, fronts ?? []);
    setRows(
      parsed.map((p, i) => ({
        key: String(++rowKey),
        front: p.front,
        back: p.back,
        comment: p.comment ?? '',
        parseError: p.error,
        include: !p.error && !dups.has(i),
      })),
    );
  };

  const selected = rows?.filter((r) => r.include && rowIsValid(r)) ?? [];

  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const onAdd = async () => {
    if (!selected.length || !settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await addNotes(
        deck.id,
        selected.map((r) => ({ front: r.front, back: r.back, comment: r.comment })),
        { createReverse: settings.createReverse },
      );
      toast(`Добавлено: ${selected.length}`);
      setRows(null);
      setText('');
    } catch {
      toast('Не удалось добавить список');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (rows) {
    return (
      <div className="card stack">
        <div className="row row--between">
          <h2 style={{ margin: 0 }}>Проверьте список</h2>
          <span className="muted small">
            выбрано {selected.length} из {rows.length}
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Строки с ошибкой подсвечены красным — их можно исправить. Дубликаты (жёлтые) по умолчанию пропускаются.
        </p>
        <PreviewTable
          rows={rows}
          onChange={setRows}
          existingFronts={fronts ?? []}
          frontLabel={isVocab ? 'Слово (EN)' : 'Вопрос'}
          backLabel={isVocab ? 'Перевод (RU)' : 'Ответ'}
        />
        <div className="row row--between">
          <button type="button" className="btn" onClick={() => setRows(null)}>
            Назад к тексту
          </button>
          <button type="button" className="btn btn--primary" disabled={!selected.length || saving || !settings} onClick={() => void onAdd()}>
            Добавить {selected.length} {plural(selected.length, 'строку', 'строки', 'строк')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <label className="field">
        Вставьте список — одна строка на слово
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'apple — яблоко\n2. well-known - известный\nto run: бежать (I run every day)\nhouse = дом // my house is big'}
          spellCheck={false}
        />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        Разделители: Tab, « — », « – », « - », «:», «=». Нумерация и маркеры в начале строк убираются. Английский
        пример в скобках в конце или текст после « //» попадёт в комментарий; русские уточнения в скобках
        останутся в переводе.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn--primary" disabled={!text.trim()} onClick={onParse}>
          Разобрать
        </button>
      </div>
    </div>
  );
}
