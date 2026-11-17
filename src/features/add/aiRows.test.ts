import { describe, expect, it } from 'vitest';
import { aiItemsToRows, rowsToNotes, uncheckDuplicates } from './aiRows';

describe('aiItemsToRows', () => {
  it('словарик: отмечено всё, кроме дубликатов колоды и строк без перевода; uncertain сохраняется', () => {
    const rows = aiItemsToRows(
      [
        { front: 'apple', back: 'яблоко' },
        { front: 'dog', back: 'собака', uncertain: true },
        { front: 'House', back: 'дом' },
        { front: 'blurry', back: '', uncertain: true },
      ],
      'dictionary',
      ['house'],
    );
    expect(rows.map((r) => [r.front, r.include, !!r.uncertain])).toEqual([
      ['apple', true, false],
      ['dog', true, true],
      ['House', false, false],
      ['blurry', false, true],
    ]);
    // В режиме словарика поле примера — только если ИИ его прочитал
    expect(rows[0]).not.toHaveProperty('example');
    expect(new Set(rows.map((r) => r.key)).size).toBe(4);
  });

  it('скрин/текст: пример и комментарий переносятся, поле примера есть всегда', () => {
    const rows = aiItemsToRows(
      [
        { front: 'give up', back: 'сдаваться', example: "Don't give up!", comment: 'фразовый глагол', kind: 'phrase' },
        { front: 'stuff', back: 'вещи' },
      ],
      'extract',
      [],
    );
    expect(rows[0]).toMatchObject({ front: 'give up', back: 'сдаваться', example: "Don't give up!", comment: 'фразовый глагол', include: true });
    expect(rows[1]).toMatchObject({ example: '', comment: '', include: true });
  });
});

describe('rowsToNotes', () => {
  it('берёт отмеченные валидные строки, пример идёт в example', () => {
    const rows = aiItemsToRows(
      [
        { front: 'give up', back: 'сдаваться', example: 'I give up.' },
        { front: 'x', back: 'икс' },
        { front: 'y', back: '' },
      ],
      'extract',
      [],
    );
    rows[1]!.include = false;
    expect(rowsToNotes(rows)).toEqual([{ front: 'give up', back: 'сдаваться', comment: '', example: 'I give up.' }]);
  });

  it('строки без поля примера — без example', () => {
    const rows = aiItemsToRows([{ front: 'a', back: 'б' }], 'dictionary', []);
    expect(rowsToNotes(rows)).toEqual([{ front: 'a', back: 'б', comment: '' }]);
  });
});

describe('uncheckDuplicates', () => {
  it('снимает галочки со строк-дубликатов новой колоды, остальные не трогает', () => {
    const rows = aiItemsToRows(
      [
        { front: 'apple', back: 'яблоко' },
        { front: 'dog', back: 'собака' },
        { front: 'cat', back: 'кошка' },
      ],
      'dictionary',
      [],
    );
    rows[2]!.include = false;
    const next = uncheckDuplicates(rows, ['Dog']);
    expect(next.map((r) => r.include)).toEqual([true, false, false]);
    expect(next[0]).toBe(rows[0]);
  });

  it('без новых дубликатов возвращает тот же массив (галочки, снятые вручную, не возвращаются)', () => {
    const rows = aiItemsToRows([{ front: 'apple', back: 'яблоко' }], 'dictionary', ['apple']);
    expect(rows[0]!.include).toBe(false);
    expect(uncheckDuplicates(rows, [])).toBe(rows);
    expect(uncheckDuplicates(rows, ['apple'])).toBe(rows);
  });
});
