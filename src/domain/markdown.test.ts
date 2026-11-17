import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToHtml, parseInline, parseMarkdown } from './markdown';

describe('escapeHtml', () => {
  it('экранирует спецсимволы', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('уже экранированная сущность экранируется ещё раз (& первым)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('markdownToHtml: безопасность', () => {
  it('<script> экранируется', () => {
    const html = markdownToHtml('<script>alert(1)</script>');
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain('<script');
  });

  it('атрибуты-обработчики экранируются', () => {
    const html = markdownToHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('HTML внутри жирного/курсива и списков экранируется', () => {
    expect(markdownToHtml('**<b>x</b>**')).toBe('<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
    expect(markdownToHtml('*<i>*')).toBe('<p><em>&lt;i&gt;</em></p>');
    expect(markdownToHtml('- <u>a</u> & b')).toBe('<ul><li>&lt;u&gt;a&lt;/u&gt; &amp; b</li></ul>');
  });

  it('амперсанд и кавычки', () => {
    expect(markdownToHtml(`Tom & Jerry's "show"`)).toBe('<p>Tom &amp; Jerry&#39;s &quot;show&quot;</p>');
  });
});

describe('markdownToHtml: разметка', () => {
  it('жирный и курсив', () => {
    expect(markdownToHtml('a **b** *c* d')).toBe('<p>a <strong>b</strong> <em>c</em> d</p>');
  });

  it('курсив внутри жирного', () => {
    expect(markdownToHtml('**bold *it* x**')).toBe('<p><strong>bold <em>it</em> x</strong></p>');
  });

  it('списки с разными маркерами', () => {
    expect(markdownToHtml('- one\n* two\n• three')).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
  });

  it('переносы строк внутри абзаца и пустая строка между абзацами', () => {
    expect(markdownToHtml('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
  });

  it('CRLF', () => {
    expect(markdownToHtml('a\r\nb')).toBe('<p>a<br>b</p>');
  });

  it('абзац, затем список, затем абзац', () => {
    expect(markdownToHtml('Правило:\n- I am\n- you are\nИтого')).toBe(
      '<p>Правило:</p><ul><li>I am</li><li>you are</li></ul><p>Итого</p>',
    );
  });

  it('*текст* в начале строки — курсив, а не список', () => {
    expect(parseMarkdown('*text*')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'italic', children: [{ type: 'text', text: 'text' }] }]] },
    ]);
  });

  it('***x*** — жирный курсив без висящих звёздочек', () => {
    expect(markdownToHtml('a ***b c*** d')).toBe('<p>a <strong><em>b c</em></strong> d</p>');
  });

  it('пустой пункт списка не рендерится', () => {
    expect(markdownToHtml('- one\n- \n-\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(markdownToHtml('- ')).toBe('');
  });

  it('пустой ввод', () => {
    expect(markdownToHtml('')).toBe('');
    expect(parseMarkdown('\n\n')).toEqual([]);
  });
});

describe('незакрытые маркеры', () => {
  it('одиночные * и ** остаются текстом', () => {
    expect(markdownToHtml('**bold')).toBe('<p>**bold</p>');
    expect(markdownToHtml('*it')).toBe('<p>*it</p>');
    expect(markdownToHtml('2 * 3 = 6')).toBe('<p>2 * 3 = 6</p>');
  });

  it('маркеры не склеиваются через строки', () => {
    expect(markdownToHtml('**a\nb**')).toBe('<p>**a<br>b**</p>');
  });

  it('a * b * c — звёздочки с пробелами не дают курсив', () => {
    expect(parseInline('a * b * c')).toEqual([{ type: 'text', text: 'a * b * c' }]);
  });

  it('при любых маркерах HTML не проскакивает', () => {
    expect(markdownToHtml('**<script>*x<script>')).not.toMatch(/<script/);
  });
});
