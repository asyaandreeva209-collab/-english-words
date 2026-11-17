// Импорт через Claude: страница словарика (фото) или скрин/текст, из которого ИИ выбирает слова.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { db } from '../../db/schema';
import { addNotes } from '../../db/repo';
import { useDeckFronts, useSettings } from '../../db/hooks';
import { isImageFile, MAX_IMAGES, prepareImage, remainingSlots, shouldCapturePaste } from '../../domain/ai/image';
import { collectKnownFronts } from '../../domain/ai/schema';
import type { Deck } from '../../domain/types';
import { useToast } from '../../ui/Toast';
import { plural } from '../../ui/plural';
import { aiItemsToRows, rowsToNotes, uncheckDuplicates, type AiMode } from './aiRows';
import { PreviewTable, type PreviewRow } from './PreviewTable';

interface Picture {
  id: string;
  dataUrl: string;
  base64: string;
}

/** Слова пользователя из словарных колод, старые → новые: в промпт уходят последние. */
async function loadKnownFronts(): Promise<string[]> {
  const [decks, notes] = await Promise.all([db.decks.toArray(), db.notes.toArray()]);
  return collectKnownFronts(decks, notes);
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : 'Не удалось обработать запрос');

/** active — вкладка видима (компонент остаётся смонтированным и на других вкладках). */
export function AiImport({ deck, active }: { deck: Deck; active: boolean }) {
  const settings = useSettings();
  const toast = useToast();
  const deckFronts = useDeckFronts(deck.id);
  const [mode, setMode] = useState<AiMode>('dictionary');
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Актуальное число картинок для addFiles (обработка асинхронная, замыкание может устареть)
  const picturesRef = useRef(pictures);
  useEffect(() => {
    picturesRef.current = pictures;
  }, [pictures]);

  // Отменяем запрос, если ушли со страницы
  useEffect(() => () => abortRef.current?.abort(), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter(isImageFile);
      if (!images.length) return;
      const slots = remainingSlots(picturesRef.current.length);
      if (images.length > slots) toast(`Не больше ${MAX_IMAGES} картинок за раз`);
      const batch = images.slice(0, slots);
      if (!batch.length) return;
      setPreparing((n) => n + batch.length);
      try {
        const prepared = await Promise.all(
          batch.map(async (f): Promise<Picture | null> => {
            try {
              const p = await prepareImage(f);
              return { id: crypto.randomUUID(), dataUrl: p.dataUrl, base64: p.base64 };
            } catch (err) {
              toast(errorText(err));
              return null;
            }
          }),
        );
        const ok = prepared.filter((p): p is Picture => p !== null);
        setPictures((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
      } finally {
        setPreparing((n) => n - batch.length);
      }
    },
    [toast],
  );

  // Ctrl+V скриншота на ПК — в любом месте страницы (только на видимой вкладке и для словарной колоды)
  const isVocab = deck.kind === 'vocab';
  useEffect(() => {
    if (rows || !active || !isVocab) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      const types = [...(e.clipboardData?.types ?? [])];
      if (!shouldCapturePaste({ targetEditable: isEditable(e.target), types, imageCount: files.length })) return;
      e.preventDefault();
      void addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles, rows, active, isVocab]);

  // Сменили колоду — строки, ставшие дубликатами новой колоды, не отмечены
  useEffect(() => {
    let cancelled = false;
    void db.notes
      .where('deckId')
      .equals(deck.id)
      .toArray()
      .then((notes) => {
        if (cancelled) return;
        const fronts = notes.map((n) => n.front);
        setRows((r) => (r ? uncheckDuplicates(r, fronts) : r));
      });
    return () => {
      cancelled = true;
    };
  }, [deck.id]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles([...e.dataTransfer.files]);
  };

  const hasInput = pictures.length > 0 || (mode === 'extract' && text.trim() !== '');
  const apiKey = settings?.claudeApiKey?.trim() ?? '';

  const onRun = async () => {
    if (!settings || !hasInput || loading || abortRef.current || preparing > 0) return;
    setError(null);
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { importWithKey } = await import('../../domain/ai/client');
      const images = pictures.map((p) => p.base64);
      const items =
        mode === 'dictionary'
          ? await importWithKey(apiKey, { mode, images }, settings.claudeModel, ctrl.signal)
          : await importWithKey(
              apiKey,
              { mode, images, text, level: settings.englishLevel, knownFronts: await loadKnownFronts() },
              settings.claudeModel,
              ctrl.signal,
            );
      if (ctrl.signal.aborted) return;
      if (!items.length) {
        setError(
          mode === 'dictionary'
            ? 'На фото не нашлось слов. Попробуйте сфотографировать ровнее и при хорошем свете.'
            : 'Новых слов не нашлось: всё уже есть в ваших колодах или слишком просто для вашего уровня.',
        );
        return;
      }
      setRows(aiItemsToRows(items, mode, deckFronts ?? []));
    } catch (err) {
      if (!ctrl.signal.aborted) setError(errorText(err));
    } finally {
      // После «Отменить» мог начаться новый запрос — его состояние не трогаем
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  const onCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const notes = rows ? rowsToNotes(rows) : [];
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!notes.length || !settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await addNotes(deck.id, notes, { createReverse: settings.createReverse });
      toast(`Добавлено в «${deck.name}»: ${notes.length}`);
      setRows(null);
      setPictures([]);
      setText('');
    } catch {
      toast('Не удалось сохранить слова');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!settings) return null;

  if (deck.kind !== 'vocab') {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Импорт из фото и текста работает только для словарных колод. Выберите другую колоду выше.</p>
      </div>
    );
  }

  if (rows) {
    return (
      <div className="card stack">
        <div className="row row--between">
          <h2 style={{ margin: 0 }}>Проверьте, что нашёл ИИ</h2>
          <span className="muted small">
            выбрано {notes.length} из {rows.length}
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {mode === 'dictionary'
            ? 'ИИ может ошибаться с почерком: проверьте каждое слово. Сомнительные строки обведены пунктиром, дубликаты (жёлтые) не отмечены.'
            : 'Снимите галочки со слов, которые не нужны. Пример взят из исходного текста и сохранится вместе со словом.'}{' '}
          Слова добавятся в колоду «{deck.name}» — её можно сменить выше.
        </p>
        <PreviewTable
          rows={rows}
          onChange={setRows}
          existingFronts={deckFronts ?? []}
          frontLabel="Слово (EN)"
          backLabel="Перевод (RU)"
        />
        <div className="row row--between">
          <button type="button" className="btn" onClick={() => setRows(null)}>
            Назад
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!notes.length || saving}
            onClick={() => void onSave()}
          >
            Сохранить {notes.length} {plural(notes.length, 'слово', 'слова', 'слов')}
          </button>
        </div>
      </div>
    );
  }

  const slotsLeft = remainingSlots(pictures.length) - preparing;

  return (
    <div className="card stack">
      <div className="segmented" role="group" aria-label="Что распознать">
        <button type="button" aria-pressed={mode === 'dictionary'} onClick={() => setMode('dictionary')}>
          Страница словарика
        </button>
        <button type="button" aria-pressed={mode === 'extract'} onClick={() => setMode('extract')}>
          Скрин или текст
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {mode === 'dictionary'
          ? 'Сфотографируйте страницу: слева английское слово, справа перевод. ИИ перепишет пары, а вы проверите их перед сохранением.'
          : `Скриншот фильма или YouTube с субтитрами, текст песни или статьи. ИИ выберет полезные слова и фразы для уровня ${settings.englishLevel} и пропустит уже известные.`}
      </p>

      {!apiKey && (
        <div className="small" style={{ color: 'var(--warning)' }}>
          Нужен API-ключ Claude — добавьте его в <Link to="/settings">настройках</Link>.
        </div>
      )}

      <div
        className={`dropzone stack${dragOver ? ' dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="row" style={{ justifyContent: 'center' }}>
          <label className={`btn${slotsLeft <= 0 ? ' btn--disabled' : ''}`}>
            Выбрать картинки
            <input
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              disabled={slotsLeft <= 0}
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
          <label className={`btn${slotsLeft <= 0 ? ' btn--disabled' : ''}`}>
            Сфоткать
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              disabled={slotsLeft <= 0}
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className="muted small">
          или перетащите сюда, или вставьте скриншот через Ctrl+V · до {MAX_IMAGES} картинок
        </div>
        {(pictures.length > 0 || preparing > 0) && (
          <div className="thumbs" style={{ justifyContent: 'center' }}>
            {pictures.map((p, i) => (
              <div key={p.id} className="thumb">
                <img src={p.dataUrl} alt={`Картинка ${i + 1}`} />
                <button
                  type="button"
                  className="thumb__remove"
                  aria-label={`Убрать картинку ${i + 1}`}
                  onClick={() => setPictures((prev) => prev.filter((x) => x.id !== p.id))}
                >
                  ×
                </button>
              </div>
            ))}
            {preparing > 0 && <div className="thumb muted small" style={{ display: 'grid', placeItems: 'center' }}>…</div>}
          </div>
        )}
      </div>

      {mode === 'extract' && (
        <label className="field">
          Или вставьте текст (субтитры, песня, статья)
          <textarea
            rows={6}
            lang="en"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I was about to give up, but then I figured it out…"
          />
        </label>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="row row--between">
        <span className="muted small">
          {loading ? 'ИИ читает… это может занять до минуты' : 'Запрос уходит в Claude с вашим ключом и оплачивается по тарифу Anthropic.'}
        </span>
        {loading ? (
          <button type="button" className="btn" onClick={onCancel}>
            Отменить
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!hasInput || !apiKey || preparing > 0}
            onClick={() => void onRun()}
          >
            {mode === 'dictionary' ? 'Распознать' : 'Найти слова'}
          </button>
        )}
      </div>
    </div>
  );
}
