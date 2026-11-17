import { describe, expect, it } from 'vitest';
import { AiResponseFormatError, collectKnownFronts, filterKnown, knownKey, parseAiResponse, stripCodeFence } from './schema';

describe('parseAiResponse', () => {
  it('валидный ответ: null-поля пропадают, пробелы нормализуются', () => {
    const text = JSON.stringify({
      items: [
        { front: ' give  up ', back: 'сдаваться, бросать', example: 'I won\'t give up.', comment: 'фразовый глагол', kind: 'phrase', uncertain: null },
        { front: 'apple', back: 'яблоко', example: null, comment: null, kind: 'word', uncertain: true },
      ],
    });
    expect(parseAiResponse(text)).toEqual([
      { front: 'give up', back: 'сдаваться, бросать', example: "I won't give up.", comment: 'фразовый глагол', kind: 'phrase' },
      { front: 'apple', back: 'яблоко', kind: 'word', uncertain: true },
    ]);
  });

  it('лишние поля отбрасываются, необязательные можно не присылать', () => {
    const text = JSON.stringify({
      items: [{ front: 'dog', back: 'собака', level: 'A1', confidence: 0.9 }],
      note: 'extra',
    });
    expect(parseAiResponse(text)).toEqual([{ front: 'dog', back: 'собака' }]);
  });

  it('незнакомый kind не ломает ответ', () => {
    const [item] = parseAiResponse(JSON.stringify({ items: [{ front: 'a', back: 'б', kind: 'idiom' }] }));
    expect(item).toEqual({ front: 'a', back: 'б' });
  });

  it('принимает голый массив и обёртку ```json', () => {
    expect(parseAiResponse('```json\n[{"front":"cat","back":"кошка"}]\n```')).toEqual([{ front: 'cat', back: 'кошка' }]);
  });

  it('пустые строки выкидываются, повторы по front — только первый', () => {
    const text = JSON.stringify({
      items: [
        { front: '', back: '' },
        { front: 'Run', back: 'бежать' },
        { front: 'run ', back: 'бегать' },
        { front: 'word', back: '' },
      ],
    });
    expect(parseAiResponse(text)).toEqual([
      { front: 'Run', back: 'бежать' },
      { front: 'word', back: '' },
    ]);
  });

  it('битый JSON → AiResponseFormatError', () => {
    expect(() => parseAiResponse('{"items": [{"front": "a", ')).toThrow(AiResponseFormatError);
    expect(() => parseAiResponse('not json at all')).toThrow(AiResponseFormatError);
  });

  it('не та структура → AiResponseFormatError', () => {
    expect(() => parseAiResponse('{"words": []}')).toThrow(AiResponseFormatError);
    expect(() => parseAiResponse('{"items": [{"front": 1, "back": "x"}]}')).toThrow(AiResponseFormatError);
    expect(() => parseAiResponse('42')).toThrow(AiResponseFormatError);
  });

  it('пустой список — не ошибка', () => {
    expect(parseAiResponse('{"items": []}')).toEqual([]);
  });
});

describe('stripCodeFence', () => {
  it('снимает ``` и ```json, остальное не трогает', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('  {"a":1} ')).toBe('{"a":1}');
  });
});

describe('filterKnown', () => {
  it('убирает уже известные слова по нормализованному front', () => {
    const items = [{ front: 'Give up' }, { front: 'figure out' }, { front: 'ёлка' }, { front: 'new' }];
    expect(filterKnown(items, ['give  UP', 'елка'])).toEqual([{ front: 'figure out' }, { front: 'new' }]);
  });

  it('глагол с «to» и без считается одним словом', () => {
    expect(filterKnown([{ front: 'look' }, { front: 'to run' }], ['to look', 'run'])).toEqual([]);
    expect(knownKey('To  Look')).toBe('look');
  });

  it('пустой список известных ничего не убирает', () => {
    expect(filterKnown([{ front: 'a' }], [])).toEqual([{ front: 'a' }]);
  });
});

describe('collectKnownFronts', () => {
  it('только словарные колоды, от старых к новым', () => {
    const decks = [
      { id: 'v1', kind: 'vocab' },
      { id: 'q1', kind: 'grammar' },
      { id: 'v2', kind: 'vocab' },
    ];
    const notes = [
      { deckId: 'v2', front: 'cat', createdAt: 3 },
      { deckId: 'q1', front: 'What is HTTP?', createdAt: 1 },
      { deckId: 'v1', front: 'dog', createdAt: 2 },
      { deckId: 'gone', front: 'ghost', createdAt: 0 },
    ];
    expect(collectKnownFronts(decks, notes)).toEqual(['dog', 'cat']);
  });
});
