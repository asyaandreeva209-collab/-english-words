// Рендер мини-markdown в React-элементы (без innerHTML — текст экранирует React).
import { parseMarkdown, type Inline } from '../domain/markdown';

function renderInline(nodes: Inline[]) {
  return nodes.map((n, i) => {
    if (n.type === 'text') return <span key={i}>{n.text}</span>;
    if (n.type === 'bold') return <strong key={i}>{renderInline(n.children)}</strong>;
    return <em key={i}>{renderInline(n.children)}</em>;
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={className ? `md ${className}` : 'md'}>
      {blocks.map((b, i) =>
        b.type === 'list' ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
