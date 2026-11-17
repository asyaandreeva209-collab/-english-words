import { describe, expect, it } from 'vitest';
import { findDuplicates, normalizeFront, parseLine, parseList } from './parseList';

const pairs = (text: string) => parseList(text).map((i) => [i.front, i.back]);

describe('parseList', () => {
  it('разбирает основные разделители и снимает нумерацию', () => {
    const items = parseList('1. apple — яблоко\r\n2) house\tдом\n\n- run: бежать\n• cat = кошка');
    expect(items.map((i) => [i.front, i.back])).toEqual([
      ['apple', 'яблоко'],
      ['house', 'дом'],
      ['run', 'бежать'],
      ['cat', 'кошка'],
    ]);
    expect(items.every((i) => !i.error)).toBe(true);
  });

  it('не ломает слова с дефисом', () => {
    const [item] = parseList('well-known - известный');
    expect(item).toMatchObject({ front: 'well-known', back: 'известный' });
  });

  it('выносит пример в комментарий и помечает строки без разделителя', () => {
    const items = parseList('go - идти (I go home)\nbig — большой // a big house\nбез разделителя');
    expect(items[0]).toMatchObject({ front: 'go', back: 'идти', comment: 'I go home' });
    expect(items[1]).toMatchObject({ front: 'big', back: 'большой', comment: 'a big house' });
    expect(items[2]?.error).toBeTruthy();
  });

  it('находит дубликаты в колоде и внутри списка', () => {
    const dups = findDuplicates([{ front: 'Apple' }, { front: 'dog' }, { front: 'DOG ' }], ['apple']);
    expect([...dups]).toEqual([0, 2]);
  });

  describe('разделители', () => {
    it.each([
      ['таб', 'apple\tяблоко'],
      ['длинное тире с пробелами', 'apple — яблоко'],
      ['короткое тире с пробелами', 'apple – яблоко'],
      ['дефис с пробелами', 'apple - яблоко'],
      ['двоеточие', 'apple: яблоко'],
      ['двоеточие без пробелов', 'apple:яблоко'],
      ['равно', 'apple = яблоко'],
      ['равно без пробелов', 'apple=яблоко'],
      ['длинное тире без пробелов', 'apple—яблоко'],
      ['короткое тире без пробелов', 'apple–яблоко'],
    ])('%s', (_name, line) => {
      const [item] = parseList(line);
      expect(item).toMatchObject({ front: 'apple', back: 'яблоко' });
      expect(item?.error).toBeUndefined();
    });

    it('таб приоритетнее дефиса с пробелами', () => {
      expect(pairs('well-known - x\tизвестный')).toEqual([['well-known - x', 'известный']]);
    });

    it('тире с пробелами приоритетнее дефиса и двоеточия', () => {
      expect(pairs('a - b: c — d')).toEqual([['a - b: c', 'd']]);
    });

    it('дефис с пробелами приоритетнее двоеточия', () => {
      expect(pairs('note: memo - заметка')).toEqual([['note: memo', 'заметка']]);
    });

    it('длинное тире с пробелами приоритетнее короткого', () => {
      expect(pairs('go – went – gone — идти')).toEqual([['go – went – gone', 'идти']]);
    });

    it('короткое тире с пробелами приоритетнее дефиса', () => {
      expect(pairs('a - b – c')).toEqual([['a - b', 'c']]);
    });

    it('двоеточие приоритетнее равно', () => {
      expect(pairs('a = b: c')).toEqual([['a = b', 'c']]);
    });

    it('делит по первому вхождению', () => {
      expect(pairs('get up - вставать - рано')).toEqual([['get up', 'вставать - рано']]);
    });

    it('дефис внутри слов с обеих сторон не считается разделителем', () => {
      expect(pairs('well-known — хорошо-известный')).toEqual([['well-known', 'хорошо-известный']]);
      expect(pairs('mother-in-law - тёща')).toEqual([['mother-in-law', 'тёща']]);
    });

    it('слово с дефисом и тире без пробелов', () => {
      expect(pairs('well-known—известный')).toEqual([['well-known', 'известный']]);
    });

    it('дефис без пробелов — не разделитель, строка с ошибкой', () => {
      const [item] = parseList('apple-яблоко');
      expect(item?.error).toBeTruthy();
    });
  });

  describe('скобки', () => {
    it('разделитель внутри скобок не считается: «to look - смотреть (look at — смотреть на)»', () => {
      const [item] = parseList('to look - смотреть (look at — смотреть на)');
      expect(item).toMatchObject({ front: 'to look', back: 'смотреть', comment: 'look at — смотреть на' });
      expect(item?.error).toBeUndefined();
    });

    it('русские скобки с тире остаются в переводе', () => {
      expect(pairs('go - идти (пешком — не ехать)')).toEqual([['go', 'идти (пешком — не ехать)']]);
    });

    it('двоеточие и равно в скобках слева пропускаются', () => {
      expect(pairs('run (I run: fast) - бежать')).toEqual([['run (I run: fast)', 'бежать']]);
      expect(pairs('a (x = y): б')).toEqual([['a (x = y)', 'б']]);
    });

    it('незакрытая скобка: разделитель ищется без учёта скобок', () => {
      expect(pairs('a (b - c')).toEqual([['a (b', 'c']]);
    });

    it('лишняя закрывающая скобка не ломает разбор', () => {
      expect(pairs('a) - b')).toEqual([['a)', 'b']]);
    });
  });

  describe('нумерация и маркеры', () => {
    it.each([
      ['1. apple - яблоко'],
      ['12. apple - яблоко'],
      ['1) apple - яблоко'],
      ['3 ) apple - яблоко'],
      ['- apple - яблоко'],
      ['• apple - яблоко'],
      ['* apple - яблоко'],
      ['   7.   apple - яблоко   '],
    ])('%s', (line) => {
      expect(pairs(line)).toEqual([['apple', 'яблоко']]);
    });

    it('после номера обязателен пробел: «1.5 - полтора» не ломается', () => {
      expect(pairs('1.5 - полтора')).toEqual([['1.5', 'полтора']]);
      expect(pairs('2)x - y')).toEqual([['2)x', 'y']]);
    });

    it('raw хранит исходную (обрезанную) строку, line — номер строки во входе', () => {
      const items = parseList('\n\n1. apple - яблоко');
      expect(items[0]).toMatchObject({ line: 3, raw: '1. apple - яблоко' });
    });
  });

  describe('пустые строки и переводы строк', () => {
    it('пустой текст и только пробельные строки дают пустой результат', () => {
      expect(parseList('')).toEqual([]);
      expect(parseList('   \n\t\n\r\n')).toEqual([]);
    });

    it('CRLF, CR и LF', () => {
      expect(pairs('a - b\r\nc - d\re - f\ng - h')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
        ['g', 'h'],
      ]);
    });

    it('в back не остаётся \\r при CRLF', () => {
      const items = parseList('a - b\r\n');
      expect(items).toHaveLength(1);
      expect(items[0]?.back).toBe('b');
    });

    it('parseLine возвращает null для пустой строки', () => {
      expect(parseLine('   ')).toBeNull();
    });
  });

  describe('ошибки', () => {
    it('строка без разделителя: error, front = текст, back пустой', () => {
      const [item] = parseList('просто текст');
      expect(item).toMatchObject({ front: 'просто текст', back: '' });
      expect(item?.error).toBeTruthy();
    });

    it('пустой перевод', () => {
      // после trim "apple -" — справа от дефиса нет пробела, разделителя нет
      expect(parseList('apple -  ')[0]?.error).toBeTruthy();
      expect(parseList('apple:')[0]).toMatchObject({ front: 'apple', back: '', error: 'Пустой перевод' });
    });

    it('пустое слово', () => {
      expect(parseList(': яблоко')[0]).toMatchObject({ front: '', back: 'яблоко', error: 'Пустое слово' });
    });

    it('ошибочные строки не мешают остальным', () => {
      const items = parseList('a - b\nплохая\nc - d');
      expect(items.map((i) => !!i.error)).toEqual([false, true, false]);
    });
  });

  describe('комментарии', () => {
    it('пример в скобках в конце', () => {
      expect(parseList('run - бежать (I run fast)')[0]).toMatchObject({
        front: 'run',
        back: 'бежать',
        comment: 'I run fast',
      });
    });

    it('скобки в середине перевода не выносятся', () => {
      const [item] = parseList('run - бежать (быстро) далеко');
      expect(item).toMatchObject({ back: 'бежать (быстро) далеко' });
      expect(item?.comment).toBeUndefined();
    });

    it('перевод, целиком состоящий из скобок, остаётся переводом', () => {
      const [item] = parseList('run - (бежать)');
      expect(item).toMatchObject({ back: '(бежать)' });
      expect(item?.error).toBeUndefined();
    });

    it('пример после //', () => {
      expect(parseList('run - бежать // I run')[0]).toMatchObject({ back: 'бежать', comment: 'I run' });
    });

    it('скобки и // одновременно объединяются', () => {
      expect(parseList('run - бежать (fast) // I run')[0]).toMatchObject({
        back: 'бежать',
        comment: 'fast; I run',
      });
    });

    it('русское уточнение в скобках остаётся в переводе', () => {
      for (const line of ['go - идти (пешком)', 'make - принимать (решение)']) {
        const [item] = parseList(line);
        expect(item?.back).toMatch(/\(.+\)$/);
        expect(item?.comment).toBeUndefined();
      }
    });

    it('смешанные скобки с латиницей уходят в комментарий', () => {
      expect(parseList('make - делать (make a cake = испечь торт)')[0]).toMatchObject({
        back: 'делать',
        comment: 'make a cake = испечь торт',
      });
    });

    it('// без пробела перед ним (URL) — не комментарий', () => {
      const [item] = parseList('site - сайт https://example.com');
      expect(item).toMatchObject({ front: 'site', back: 'сайт https://example.com' });
      expect(item?.comment).toBeUndefined();
    });

    it('пустой комментарий после // не создаётся', () => {
      const [item] = parseList('run - бежать //');
      expect(item?.back).toBe('бежать');
      expect(item?.comment).toBeUndefined();
    });

    it('строка без разделителя, но с //: ошибка, комментарий сохранён', () => {
      const [item] = parseList('run // пример');
      expect(item?.error).toBeTruthy();
      expect(item?.comment).toBe('пример');
    });
  });
});

describe('normalizeFront', () => {
  it('регистр, ё, пробелы', () => {
    expect(normalizeFront('  Ёлка   Big\tTree ')).toBe('елка big tree');
  });
});

describe('findDuplicates', () => {
  it('пустой список', () => {
    expect(findDuplicates([], ['a']).size).toBe(0);
  });

  it('пустой front не считается дубликатом', () => {
    expect([...findDuplicates([{ front: '' }, { front: '  ' }], [''])]).toEqual([]);
  });

  it('нормализация ё и пробелов', () => {
    const dups = findDuplicates([{ front: 'всё  равно' }, { front: 'new' }], ['Все равно']);
    expect([...dups]).toEqual([0]);
  });

  it('existingFronts принимает любой Iterable', () => {
    expect([...findDuplicates([{ front: 'x' }], new Set(['X']))]).toEqual([0]);
  });

  it('первое вхождение в списке не дубликат, последующие — дубликаты', () => {
    const dups = findDuplicates([{ front: 'a' }, { front: 'A' }, { front: 'a' }, { front: 'b' }], []);
    expect([...dups]).toEqual([1, 2]);
  });
});
