// Разбор массовой вставки списка слов: одна строка — одно слово.

export interface ParsedItem {
  /** Номер строки во входном тексте (с 1). */
  line: number;
  raw: string;
  front: string;
  back: string;
  comment?: string;
  error?: string;
}

// После «1.»/«1)» обязателен пробел, чтобы «1.5 - полтора» не превращалось в «5 - полтора»
const LIST_MARKER = /^(?:\d+\s*[.)]\s+|[-•*·]\s+)/;
const TRAILING_PARENS = /\s*\(([^()]*)\)\s*$/;
/** «//» — начало комментария, только если перед ним пробел или начало строки (URL не ломаем). */
const COMMENT_SLASHES = /(?:^|\s)\/\//;
/** Пример в скобках выносим, только если внутри есть латиница: «(пешком)» — часть перевода. */
const HAS_LATIN = /[A-Za-z]/;

/**
 * Разделители по приоритету; первый найденный — делим по первому вхождению.
 * Длинное тире раньше короткого: «go – went – gone — идти» → «go – went – gone» / «идти».
 */
const SEPARATORS: RegExp[] = [
  /\t/g,
  / — /g,
  / – /g,
  / - /g,
  /:/g,
  /=/g,
  /[—–]/g,
];

/** Глубина вложенности круглых скобок для каждой позиции (UTF-16). Лишние «)» не уводят в минус. */
function parenDepths(text: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ')') depth = Math.max(0, depth - 1);
    depths.push(depth);
    if (ch === '(') depth++;
  }
  return depths;
}

/**
 * Делит по первому разделителю вне скобок: «to look - смотреть (look at — смотреть на)»
 * → «to look» / «смотреть (look at — смотреть на)». Если вне скобок разделителя нет
 * (например, скобка не закрыта) — ищем без учёта скобок.
 */
function splitByFirst(text: string): [string, string] | null {
  const depths = parenDepths(text);
  for (const outsideOnly of [true, false]) {
    for (const sep of SEPARATORS) {
      for (const m of text.matchAll(sep)) {
        if (outsideOnly && (depths[m.index] ?? 0) > 0) continue;
        return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
      }
    }
  }
  return null;
}

function joinComments(a: string | undefined, b: string | undefined): string | undefined {
  const parts = [a, b].filter((s): s is string => !!s && s.trim() !== '');
  return parts.length ? parts.join('; ') : undefined;
}

export function parseLine(rawLine: string, line = 1): ParsedItem | null {
  let text = rawLine.trim();
  if (text === '') return null;
  const raw = text;

  text = text.replace(LIST_MARKER, '').trim();

  // Пример после // — в комментарий
  let comment: string | undefined;
  const sm = COMMENT_SLASHES.exec(text);
  if (sm) {
    comment = text.slice(sm.index + sm[0].length).trim() || undefined;
    text = text.slice(0, sm.index).trim();
  }

  const parts = splitByFirst(text);
  if (!parts) {
    return { line, raw, front: text, back: '', comment, error: 'Не найден разделитель между словом и переводом' };
  }

  const front = parts[0].trim();
  let back = parts[1].trim();

  // Английский пример в скобках в конце — в комментарий (если после этого перевод не пустой)
  const pm = TRAILING_PARENS.exec(back);
  if (pm && pm.index > 0 && HAS_LATIN.test(pm[1] ?? '')) {
    back = back.slice(0, pm.index).trim();
    comment = joinComments(pm[1]?.trim(), comment);
  }

  const item: ParsedItem = { line, raw, front, back };
  if (comment) item.comment = comment;
  if (!front) item.error = 'Пустое слово';
  else if (!back) item.error = 'Пустой перевод';
  return item;
}

export function parseList(text: string): ParsedItem[] {
  const result: ParsedItem[] = [];
  text.split(/\r\n|\r|\n/).forEach((l, i) => {
    const item = parseLine(l, i + 1);
    if (item) result.push(item);
  });
  return result;
}

/** Нормализация лицевой стороны для поиска дубликатов. */
export function normalizeFront(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

/**
 * Индексы элементов, которые дублируют уже существующие слова колоды
 * или более ранние строки этого же списка.
 */
export function findDuplicates(items: { front: string }[], existingFronts: Iterable<string>): Set<number> {
  const seen = new Set<string>();
  for (const f of existingFronts) seen.add(normalizeFront(f));
  const dups = new Set<number>();
  items.forEach((it, i) => {
    const key = normalizeFront(it.front);
    if (!key) return;
    if (seen.has(key)) dups.add(i);
    else seen.add(key);
  });
  return dups;
}
