// Восстановление из файла резервной копии: выбор файла, предпросмотр, объединение или замена.
import { useRef, useState } from 'react';
import { applyImport, previewImport } from '../../db/importBackup';
import { BackupImportError, parseBackupJson, type EntityStats, type ImportMode, type ParsedBackup } from '../../domain/backupImport';
import { Modal } from '../../ui/Modal';
import { plural } from '../../ui/plural';
import { useToast } from '../../ui/Toast';
import { downloadBackup } from './downloadBackup';

type Preview = Awaited<ReturnType<typeof previewImport>>;

const MODES: { value: ImportMode; label: string }[] = [
  { value: 'merge', label: 'Объединить' },
  { value: 'replace', label: 'Заменить всё' },
];

const ENTITY_LABELS = [
  ['decks', 'Колоды'],
  ['notes', 'Слова'],
  ['cards', 'Карточки'],
  ['reviewLogs', 'История ответов'],
] as const;

const errorText = (err: unknown, fallback: string) =>
  err instanceof BackupImportError ? err.message : err instanceof Error ? `${fallback}: ${err.message}` : fallback;

const noop = () => {};

/** Больше этого — точно не наша копия; файл даже не читаем. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const words = (n: number) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

function formatExportedAt(t: number): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? 'дата неизвестна' : d.toLocaleString('ru-RU');
}

export function ImportBackup() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applySettings, setApplySettings] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Номера последних запросов: ответы на устаревшие игнорируем
  const previewReq = useRef(0);
  const fileReq = useRef(0);
  // Номер открытой модалки: завершившееся действие не должно закрыть другую
  const session = useRef(0);

  const loadPreview = async (p: ParsedBackup, m: ImportMode, initDefaults = false) => {
    const req = ++previewReq.current;
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await previewImport(p, m);
      if (req !== previewReq.current) return;
      setPreview(res);
      // На новом устройстве (настроек ещё нет) по умолчанию переносим и их
      if (initDefaults) setApplySettings(!res.hasLocalSettings);
    } catch (err) {
      if (req === previewReq.current) setPreviewError(errorText(err, 'Не удалось прочитать текущие данные'));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file || busy || parsed) return;
    const req = ++fileReq.current;
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Файл слишком большой для резервной копии');
      return;
    }
    try {
      const text = await file.text();
      if (req !== fileReq.current) return;
      const p = parseBackupJson(text);
      session.current++;
      setParsed(p);
      setMode('merge');
      setApplySettings(false);
      setConfirming(false);
      setDownloadError(null);
      setApplyError(null);
      await loadPreview(p, 'merge', true);
    } catch (err) {
      if (req === fileReq.current) setFileError(errorText(err, 'Не удалось прочитать файл'));
    }
  };

  const close = () => {
    session.current++;
    previewReq.current++;
    setParsed(null);
    setPreview(null);
    setConfirming(false);
    setPreviewError(null);
    setDownloadError(null);
    setApplyError(null);
  };

  const changeMode = (m: ImportMode) => {
    if (!parsed || m === mode) return;
    setMode(m);
    setConfirming(false);
    setApplyError(null);
    void loadPreview(parsed, m);
  };

  const onApply = async () => {
    if (!parsed) return;
    const s = session.current;
    setBusy(true);
    setApplyError(null);
    try {
      const plan = await applyImport(parsed, mode, { applySettings: mode === 'merge' && applySettings });
      if (mode === 'replace') {
        toast(`Готово: восстановлено ${words(plan.result.notes.length)}`);
      } else {
        const { added, updated } = plan.stats.notes;
        toast(`Готово: добавлено ${words(added)}, обновлено ${words(updated)}`);
      }
      if (s === session.current) close();
    } catch (err) {
      if (s === session.current) {
        setApplyError(errorText(err, 'Не удалось восстановить данные, ничего не изменено'));
        setConfirming(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDownloadCurrent = async () => {
    setDownloadError(null);
    try {
      await downloadBackup();
      toast('Файл резервной копии сохранён');
    } catch (err) {
      setDownloadError(errorText(err, 'Не удалось сохранить копию'));
    }
  };

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy || parsed !== null}
            onClick={() => inputRef.current?.click()}
          >
            Восстановить из файла
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        {fileError && <div className="error-text">{fileError}</div>}
      </div>

      {parsed && (
        <Modal title="Восстановление из копии" onClose={busy ? noop : close}>
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              Копия от {formatExportedAt(parsed.exportedAt)}. В файле: {parsed.decks.length}{' '}
              {plural(parsed.decks.length, 'колода', 'колоды', 'колод')}, {parsed.notes.length}{' '}
              {plural(parsed.notes.length, 'слово', 'слова', 'слов')}, {parsed.cards.length}{' '}
              {plural(parsed.cards.length, 'карточка', 'карточки', 'карточек')}, {parsed.reviewLogs.length}{' '}
              {plural(parsed.reviewLogs.length, 'запись', 'записи', 'записей')} истории.
            </p>

            <div className="segmented" role="group" aria-label="Способ восстановления">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={mode === m.value}
                  disabled={busy}
                  onClick={() => changeMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {previewError ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="error-text">{previewError}</div>
                <div className="row">
                  <button type="button" className="btn" disabled={busy} onClick={() => void loadPreview(parsed, mode)}>
                    Повторить
                  </button>
                </div>
              </div>
            ) : !preview ? (
              <p className="muted small">Считаю изменения…</p>
            ) : mode === 'merge' ? (
              <MergePreview preview={preview} duplicateIds={parsed.warnings.duplicateIds} />
            ) : (
              <ReplacePreview preview={preview} duplicateIds={parsed.warnings.duplicateIds} />
            )}

            {mode === 'merge' && preview && parsed.settings !== null && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={applySettings}
                  disabled={busy}
                  onChange={(e) => setApplySettings(e.target.checked)}
                />
                <span>Также перенести настройки (лимит, тема, направления, модель ИИ)</span>
              </label>
            )}

            {applyError && <div className="error-text">{applyError}</div>}

            {mode === 'replace' && !confirming && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="row">
                  <button type="button" className="btn" disabled={busy} onClick={() => void onDownloadCurrent()}>
                    Сначала скачать копию текущих данных
                  </button>
                </div>
                {downloadError && <div className="error-text">{downloadError}</div>}
              </div>
            )}

            {confirming ? (
              <div className="stack" style={{ gap: 8 }}>
                <strong>Точно заменить? Отменить нельзя.</strong>
                <div className="row">
                  <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                    Отмена
                  </button>
                  <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void onApply()}>
                    {busy ? 'Заменяю…' : 'Заменить'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button type="button" className="btn" disabled={busy} onClick={close}>
                  Отмена
                </button>
                {mode === 'merge' ? (
                  <button type="button" className="btn btn--primary" disabled={busy || !preview} onClick={() => void onApply()}>
                    {busy ? 'Объединяю…' : 'Объединить'}
                  </button>
                ) : (
                  <button type="button" className="btn btn--danger" disabled={busy || !preview} onClick={() => setConfirming(true)}>
                    Заменить всё…
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function Warnings({ preview, duplicateIds }: { preview: Preview; duplicateIds: number }) {
  const dropped = preview.dropped.notes + preview.dropped.cards + preview.dropped.reviewLogs;
  const { notes: dupNotes, deckNames } = preview.possibleDuplicates;
  if (!dropped && !duplicateIds && !dupNotes && !deckNames.length) return null;
  return (
    <div className="notice notice--warning" style={{ margin: 0 }}>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {dropped > 0 && (
          <li>
            Пропущено записей с битыми ссылками (нет колоды, слова или карточки): {dropped}.
          </li>
        )}
        {duplicateIds > 0 && <li>В файле повторялись записи — оставлены более новые: {duplicateIds}.</li>}
        {dupNotes > 0 && <li>Возможных дубликатов: {dupNotes} — проверьте колоды.</li>}
        {deckNames.length > 0 && <li>Колоды с одинаковыми названиями: {deckNames.join(', ')}.</li>}
      </ul>
    </div>
  );
}

function MergePreview({ preview, duplicateIds }: { preview: Preview; duplicateIds: number }) {
  return (
    <>
      <table className="import-stats">
        <thead>
          <tr>
            <th />
            <th>Добавлено</th>
            <th>Обновлено</th>
            <th>Без изменений</th>
          </tr>
        </thead>
        <tbody>
          {ENTITY_LABELS.map(([key, label]) => {
            const s: EntityStats = preview.stats[key];
            return (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{s.added}</td>
                <td>{s.updated}</td>
                <td>{s.unchanged}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ margin: 0 }}>
        Из двух версий одной записи остаётся более новая; то, чего нет в файле, сохранится. Удалённые слова при
        объединении не удаляются: если слово есть в файле, оно вернётся (даже если вы удалили его здесь после создания
        копии).
      </p>
      <Warnings preview={preview} duplicateIds={duplicateIds} />
    </>
  );
}

function ReplacePreview({ preview, duplicateIds }: { preview: Preview; duplicateIds: number }) {
  const { decks, notes } = preview.localCounts;
  return (
    <>
      <div className="notice notice--warning" style={{ margin: 0 }}>
        С этого устройства будет удалено: {decks} {plural(decks, 'колода', 'колоды', 'колод')}, {notes}{' '}
        {plural(notes, 'слово', 'слова', 'слов')} и весь прогресс. Ключ API останется.
      </div>
      <Warnings preview={preview} duplicateIds={duplicateIds} />
    </>
  );
}
