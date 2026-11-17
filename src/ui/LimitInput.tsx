// Числовое поле лимита: правится как строка, сохраняется на blur/Enter, если число валидно (целое 0…max, по умолчанию 200).
import { useEffect, useState } from 'react';
import { parseLimit } from '../domain/limits';

interface Props {
  value: number | undefined;
  /** undefined — поле очищено (только при allowEmpty). */
  onCommit: (value: number | undefined) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Верхняя граница (по умолчанию MAX_LIMIT). */
  max?: number;
}

export function LimitInput({ value, onCommit, allowEmpty, placeholder, ariaLabel, max }: Props) {
  const [text, setText] = useState(value === undefined ? '' : String(value));

  // Внешнее значение поменялось (ползунок, другая вкладка) — подтягиваем
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);

  const commit = () => {
    if (allowEmpty && text.trim() === '') {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = parseLimit(text, max);
    if (n === null) {
      setText(value === undefined ? '' : String(value)); // невалидно — откат
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={{ width: 90 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
