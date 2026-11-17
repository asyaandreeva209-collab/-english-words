// Редактируемый предпросмотр списка перед добавлением (массовая вставка и импорт через ИИ).
import { useMemo } from 'react';
import { findDuplicates } from '../../domain/parseList';
import { IconTrash } from '../../ui/icons';

export interface PreviewRow {
  key: string;
  front: string;
  back: string;
  comment: string;
  /** Пример; undefined — поле не показываем (массовая вставка). */
  example?: string;
  /** ИИ не уверен в распознавании — подсветить. */
  uncertain?: boolean;
  /** Ошибка разбора исходной строки (показываем, пока строка не исправлена). */
  parseError?: string;
  include: boolean;
}

export function rowIsValid(r: PreviewRow): boolean {
  return r.front.trim() !== '' && r.back.trim() !== '';
}

interface Props {
  rows: PreviewRow[];
  onChange: (rows: PreviewRow[]) => void;
  existingFronts: string[];
  frontLabel: string;
  backLabel: string;
}

export function usePreviewDuplicates(rows: PreviewRow[], existingFronts: string[]): Set<number> {
  return useMemo(() => findDuplicates(rows, existingFronts), [rows, existingFronts]);
}

export function PreviewTable({ rows, onChange, existingFronts, frontLabel, backLabel }: Props) {
  const dups = usePreviewDuplicates(rows, existingFronts);

  const update = (i: number, patch: Partial<PreviewRow>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="preview">
      {rows.map((r, i) => {
        const valid = rowIsValid(r);
        const dup = dups.has(i);
        const cls = !valid
          ? ' preview-row--error'
          : dup
            ? ' preview-row--dup'
            : r.uncertain
              ? ' preview-row--uncertain'
              : '';
        return (
          <div key={r.key} className={`preview-row${cls}`}>
            <input
              type="checkbox"
              checked={valid && r.include}
              disabled={!valid}
              onChange={(e) => update(i, { include: e.target.checked })}
              aria-label="Добавлять эту строку"
              style={{ width: 20, height: 20, marginTop: 10 }}
            />
            <div className="stack" style={{ gap: 4 }}>
              <div className="preview-row__fields">
                <input
                  type="text"
                  value={r.front}
                  placeholder={frontLabel}
                  aria-label={frontLabel}
                  onChange={(e) => update(i, { front: e.target.value })}
                />
                <input
                  type="text"
                  value={r.back}
                  placeholder={backLabel}
                  aria-label={backLabel}
                  onChange={(e) => update(i, { back: e.target.value })}
                />
                <input
                  type="text"
                  value={r.comment}
                  placeholder="Комментарий"
                  aria-label="Комментарий"
                  onChange={(e) => update(i, { comment: e.target.value })}
                />
              </div>
              {r.example !== undefined && (
                <input
                  type="text"
                  lang="en"
                  className="preview-row__example"
                  value={r.example}
                  placeholder="Пример"
                  aria-label="Пример"
                  onChange={(e) => update(i, { example: e.target.value })}
                />
              )}
              {!valid && <div className="error-text">{r.parseError ?? 'Заполните слово и перевод'}</div>}
              {valid && dup && <div className="small" style={{ color: 'var(--warning)' }}>Уже есть в колоде или выше в списке</div>}
              {valid && !dup && r.uncertain && (
                <div className="small" style={{ color: 'var(--warning)' }}>ИИ не уверен, что прочитал верно — проверьте</div>
              )}
            </div>
            <button
              type="button"
              className="btn btn--ghost icon-btn"
              onClick={() => remove(i)}
              aria-label="Удалить строку"
              title="Удалить строку"
            >
              <IconTrash />
            </button>
          </div>
        );
      })}
    </div>
  );
}
