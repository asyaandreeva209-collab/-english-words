// Безопасный мини-markdown: **жирный**, *курсив*, списки «- », переносы строк.
// Разбор в дерево без HTML; рендер в React — ui/Markdown.tsx.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] };

export type Block =
  /** Абзац; строки внутри разделяются переносом. */
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'list'; items: Inline[][] };

/** Пункт списка; «-» без текста — пустой пункт, его не рендерим. */
const LIST_ITEM = /^\s*[-*•](?:\s+(.*))?$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // ***x*** — жирный курсив, **x** — жирный, *x* — курсив
  const re = /\*\*\*([^*\s](?:[^*]*[^*\s])?)\*\*\*|\*\*(.+?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ type: 'bold', children: [{ type: 'italic', children: parseInline(m[1]) }] });
    } else if (m[2] !== undefined) {
      out.push({ type: 'bold', children: parseInline(m[2]) });
    } else {
      out.push({ type: 'italic', children: parseInline(m[3] ?? '') });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Inline[][] | null = null;

  for (const line of src.split(/\r\n|\r|\n/)) {
    const li = LIST_ITEM.exec(line);
    if (li) {
      const content = (li[1] ?? '').trim();
      if (!content) continue;
      para = null;
      if (!list) blocks.push({ type: 'list', items: (list = []) });
      list.push(parseInline(content));
    } else if (line.trim() === '') {
      para = null;
      list = null;
    } else {
      list = null;
      if (!para) blocks.push({ type: 'paragraph', lines: (para = []) });
      para.push(parseInline(line.trim()));
    }
  }
  return blocks;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineToHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return escapeHtml(n.text);
      const tag = n.type === 'bold' ? 'strong' : 'em';
      return `<${tag}>${inlineToHtml(n.children)}</${tag}>`;
    })
    .join('');
}

/** HTML-строка с экранированием (для экспорта/тестов; в UI используется React-рендер). */
export function markdownToHtml(src: string): string {
  return parseMarkdown(src)
    .map((b) =>
      b.type === 'list'
        ? `<ul>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</ul>`
        : `<p>${b.lines.map(inlineToHtml).join('<br>')}</p>`,
    )
    .join('');
}
