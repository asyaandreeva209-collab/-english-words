import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest, checkKey, MAX_TOKENS, readResponse, runAiImport, type AiMessage, type AiTransport } from './client';
import { AiError } from './errors';
import { KNOWN_WORDS_LIMIT, trimKnownFronts } from './prompts';

const textMsg = (text: string, stop_reason = 'end_turn'): AiMessage => ({ content: [{ type: 'text', text }], stop_reason });

function mockTransport(impl: AiTransport['createMessage']): AiTransport & { createMessage: ReturnType<typeof vi.fn> } {
  return { createMessage: vi.fn(impl), checkModel: vi.fn(async () => {}) };
}

/** Текст всех текстовых блоков запроса. */
function promptText(params: ReturnType<typeof buildRequest>): string {
  const content = params.messages[0]?.content;
  if (!Array.isArray(content)) return String(content);
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

describe('buildRequest', () => {
  it('режим «словарик»: модель, max_tokens, картинки перед инструкцией, effort, без thinking', () => {
    const p = buildRequest({ mode: 'dictionary', images: ['AAA', 'BBB'] }, 'claude-opus-5-5');
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(MAX_TOKENS);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]?.role).toBe('user');
    const content = p.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'text']);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } });
    expect(p.output_config?.effort).toBe('medium');
    expect(p.output_config?.format?.type).toBe('json_schema');
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('temperature');
    expect(p).not.toHaveProperty('top_p');
    expect(JSON.stringify(p)).not.toContain('budget_tokens');
    expect(promptText(p)).toMatch(/uncertain/);
  });

  it('JSON Schema ответа: объект items без лишних свойств', () => {
    const p = buildRequest({ mode: 'dictionary', images: ['A'] }, 'claude-opus-5-5');
    const schema = p.output_config?.format?.schema as { type: string; properties: Record<string, unknown>; additionalProperties?: boolean };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['items']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('режим «скрин/текст»: уровень и известные слова в промпте, текст источника в тегах', () => {
    const p = buildRequest(
      { mode: 'extract', images: ['IMG'], text: '  I gave up.  ', level: 'B2', knownFronts: ['figure out', 'apple'] },
      'claude-sonnet-5-5',
    );
    const content = p.messages[0]?.content;
    if (!Array.isArray(content)) throw new Error('content не массив');
    expect(content.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    const text = promptText(p);
    expect(text).toContain('<source_text>\nI gave up.\n</source_text>');
    expect(text).toContain('CEFR level B2');
    expect(text).toContain('figure out; apple');
    expect(p.output_config?.effort).toBe('medium');
  });

  it('только текст — без image-блоков', () => {
    const p = buildRequest({ mode: 'extract', images: [], text: 'hello', level: 'A2', knownFronts: [] }, 'claude-opus-5-5');
    const content = p.messages[0]?.content;
    if (!Array.isArray(content)) throw new Error('content не массив');
    expect(content.every((b) => b.type === 'text')).toBe(true);
    expect(promptText(p)).toContain('(none)');
  });

  it('Haiku 4.5: без effort', () => {
    const p = buildRequest({ mode: 'dictionary', images: ['A'] }, 'claude-haiku-4-5');
    expect(p.output_config).not.toHaveProperty('effort');
    expect(p.output_config?.format?.type).toBe('json_schema');
  });

  it('в промпт уходят только последние KNOWN_WORDS_LIMIT известных слов', () => {
    const many = Array.from({ length: KNOWN_WORDS_LIMIT + 10 }, (_, i) => `w${i}`);
    const trimmed = trimKnownFronts(many);
    expect(trimmed).toHaveLength(KNOWN_WORDS_LIMIT);
    expect(trimmed[0]).toBe('w10');
    const text = promptText(buildRequest({ mode: 'extract', images: [], text: 'x', level: 'B1', knownFronts: many }, 'claude-opus-5-5'));
    expect(text).not.toContain('w9;');
    expect(text).toContain(`w${KNOWN_WORDS_LIMIT + 9}`);
  });
});

describe('readResponse', () => {
  it('склеивает текстовые блоки и пропускает прочие', () => {
    const msg: AiMessage = {
      content: [{ type: 'thinking' }, { type: 'text', text: '{"items":[{"front":"a","back":"б"}]}' }],
      stop_reason: 'end_turn',
    };
    expect(readResponse(msg)).toEqual([{ front: 'a', back: 'б' }]);
  });

  it('refusal → понятная ошибка', () => {
    expect(() => readResponse(textMsg('', 'refusal'))).toThrow(expect.objectContaining({ code: 'refusal' }));
  });

  it('max_tokens → «разбейте на части»', () => {
    try {
      readResponse(textMsg('{"items":[', 'max_tokens'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('too_long');
      expect((err as AiError).message).toMatch(/разбейте на части/);
    }
  });

  it('пустой ответ → bad_response', () => {
    expect(() => readResponse({ content: [], stop_reason: 'end_turn' })).toThrow(expect.objectContaining({ code: 'bad_response' }));
  });
});

describe('runAiImport (мок транспорта)', () => {
  it('передаёт собранный запрос и signal, разбирает ответ', async () => {
    const t = mockTransport(async () => textMsg('{"items":[{"front":"cat","back":"кошка","example":null,"comment":null,"kind":"word","uncertain":null}]}'));
    const ctrl = new AbortController();
    const items = await runAiImport(t, { mode: 'dictionary', images: ['X'] }, 'claude-opus-5-5', ctrl.signal);
    expect(items).toEqual([{ front: 'cat', back: 'кошка', kind: 'word' }]);
    expect(t.createMessage).toHaveBeenCalledTimes(1);
    const [params, signal] = t.createMessage.mock.calls[0] as [ReturnType<typeof buildRequest>, AbortSignal];
    expect(params.model).toBe('claude-opus-5-5');
    expect(signal).toBe(ctrl.signal);
  });

  it('режим «скрин/текст»: уже известные слова отфильтрованы на клиенте', async () => {
    const t = mockTransport(async () =>
      textMsg(JSON.stringify({ items: [{ front: 'give up', back: 'сдаваться' }, { front: 'Apple', back: 'яблоко' }] })),
    );
    const items = await runAiImport(
      t,
      { mode: 'extract', images: [], text: 'I give up, apple', level: 'B1', knownFronts: ['apple'] },
      'claude-sonnet-5-5',
    );
    expect(items.map((i) => i.front)).toEqual(['give up']);
  });

  it('без картинок и текста — ошибка без запроса', async () => {
    const t = mockTransport(async () => textMsg('{}'));
    await expect(runAiImport(t, { mode: 'extract', images: [], text: '  ', level: 'B1', knownFronts: [] }, 'claude-opus-5-5')).rejects.toBeInstanceOf(AiError);
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  const headers = new Headers();
  it.each([
    ['AuthenticationError', new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', headers), 'auth', /Неверный/],
    ['RateLimitError', new Anthropic.RateLimitError(429, undefined, 'rate', headers), 'rate_limit', /Слишком много запросов/],
    ['APIConnectionError', new Anthropic.APIConnectionError({ message: 'fetch failed' }), 'network', /Нет сети/],
    ['APIConnectionTimeoutError', new Anthropic.APIConnectionTimeoutError(), 'network', /не отвечает/],
    ['BadRequestError', new Anthropic.BadRequestError(400, undefined, 'bad', headers), 'bad_request', /отклонил/],
    ['PermissionDeniedError', new Anthropic.PermissionDeniedError(403, undefined, 'no', headers), 'permission', /доступа/],
    ['NotFoundError', new Anthropic.NotFoundError(404, undefined, 'no model', headers), 'not_found', /Модель/],
    ['InternalServerError', new Anthropic.InternalServerError(529, undefined, 'overloaded', headers), 'overloaded', /перегружен/],
    ['APIError', new Anthropic.APIError(418, undefined, 'teapot', headers), 'api', /Ошибка сервера/],
    ['APIUserAbortError', new Anthropic.APIUserAbortError(), 'aborted', /отменён/],
    ['обычная Error', new Error('boom'), 'unknown', /Не удалось/],
  ])('%s → AiError', async (_name, thrown, code, message) => {
    const t = mockTransport(async () => {
      throw thrown;
    });
    const p = runAiImport(t, { mode: 'dictionary', images: ['X'] }, 'claude-opus-5-5');
    await expect(p).rejects.toBeInstanceOf(AiError);
    await expect(p).rejects.toMatchObject({ code, message: expect.stringMatching(message) });
  });

  it('битый JSON от модели → bad_response', async () => {
    const t = mockTransport(async () => textMsg('{"items": [oops'));
    await expect(runAiImport(t, { mode: 'dictionary', images: ['X'] }, 'claude-opus-5-5')).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('checkKey', () => {
  it('успех и ошибка ключа', async () => {
    const ok: AiTransport = { createMessage: vi.fn(), checkModel: vi.fn(async () => {}) };
    await expect(checkKey(ok, 'claude-haiku-4-5')).resolves.toBeUndefined();
    expect(ok.checkModel).toHaveBeenCalledWith('claude-haiku-4-5', undefined);

    const bad: AiTransport = {
      createMessage: vi.fn(),
      checkModel: vi.fn(async () => {
        throw new Anthropic.AuthenticationError(401, undefined, 'invalid', new Headers());
      }),
    };
    await expect(checkKey(bad, 'claude-opus-5-5')).rejects.toMatchObject({ code: 'auth' });
  });
});
