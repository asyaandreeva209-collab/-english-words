// Поля слова/карточки — общие для добавления и редактирования.
// Должны лежать внутри <form>: Enter в однострочном поле отправляет форму, в textarea — Ctrl+Enter.
import type { KeyboardEvent } from 'react';
import type { NoteInput } from '../../db/repo';
import type { DeckKind } from '../../domain/types';
import { Markdown } from '../../ui/Markdown';

interface Props {
  kind: DeckKind;
  value: NoteInput;
  onChange: (v: NoteInput) => void;
  /** Колбэк-ref первого поля (для фокуса после сохранения). */
  frontRef?: (el: HTMLElement | null) => void;
}

function submitOnCtrlEnter(e: KeyboardEvent<HTMLTextAreaElement>): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
}

export function NoteFields({ kind, value, onChange, frontRef }: Props) {
  const set = (k: keyof NoteInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });

  if (kind === 'grammar') {
    return (
      <div className="stack">
        <label className="field">
          Вопрос
          <textarea ref={frontRef} rows={2} value={value.front} onChange={set('front')} onKeyDown={submitOnCtrlEnter} />
        </label>
        <label className="field">
          Ответ (поддерживается **жирный**, *курсив*, списки «- »)
          <textarea rows={5} value={value.back} onChange={set('back')} onKeyDown={submitOnCtrlEnter} />
        </label>
        {value.back.trim() && (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="muted small">Предпросмотр ответа</div>
            <Markdown text={value.back} />
          </div>
        )}
        <label className="field">
          Комментарий
          <input type="text" value={value.comment ?? ''} onChange={set('comment')} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Ctrl+Enter — сохранить
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <label className="field">
        Слово (EN)
        <input
          ref={frontRef}
          type="text"
          lang="en"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value.front}
          onChange={set('front')}
        />
      </label>
      <label className="field">
        Перевод (RU), варианты через запятую
        <input type="text" lang="ru" value={value.back} onChange={set('back')} />
      </label>
      <div className="row">
        <label className="field grow">
          Транскрипция
          <input type="text" value={value.transcription ?? ''} onChange={set('transcription')} />
        </label>
        <label className="field grow">
          Пример
          <input type="text" lang="en" value={value.example ?? ''} onChange={set('example')} />
        </label>
      </div>
      <label className="field">
        Комментарий
        <input type="text" value={value.comment ?? ''} onChange={set('comment')} />
      </label>
    </div>
  );
}
