// Вызов Claude API через официальный SDK. Модуль тяжёлый (SDK) — UI грузит его динамическим import().
// Сборка запроса и разбор ответа — чистые функции; сеть спрятана за AiTransport, чтобы её можно было подменить в тестах.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ContentBlockParam, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { ClaudeModel, EnglishLevel } from '../types';
import { AiError, toAiError } from './errors';
import { dictionaryPagePrompt, extractPrompt, sourceTextBlock } from './prompts';
import { AiOutputSchema, filterKnown, parseAiResponse, type AiItem } from './schema';

export const MAX_TOKENS = 16000;

export type AiRequest =
  | {
      /** Режим А: фото страницы словарика. images — base64 JPEG без префикса data:. */
      mode: 'dictionary';
      images: string[];
    }
  | {
      /** Режим Б: скриншоты и/или текст — ИИ сам выбирает полезные слова и фразы. */
      mode: 'extract';
      images: string[];
      text?: string;
      level: EnglishLevel;
      /** Все уже известные слова (в промпт уходят последние KNOWN_WORDS_LIMIT, фильтр на клиенте — по всем). */
      knownFronts: string[];
    };

/** Минимальная форма ответа, которую мы читаем (Message из SDK ей соответствует). */
export interface AiMessage {
  content: ReadonlyArray<{ type: string; text?: string }>;
  stop_reason: string | null;
}

/** Сетевой слой. В приложении — SDK, в тестах — мок. */
export interface AiTransport {
  createMessage(params: MessageCreateParamsNonStreaming, signal?: AbortSignal): Promise<AiMessage>;
  /** Дешёвая проверка ключа: информация о модели (без генерации токенов). */
  checkModel(model: ClaudeModel, signal?: AbortSignal): Promise<void>;
}

export function createTransport(apiKey: string): AiTransport {
  // dangerouslyAllowBrowser добавляет заголовок для прямых запросов из браузера (ключ — пользователя)
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    createMessage: (params, signal) => client.messages.create(params, { signal }),
    checkModel: async (model, signal) => {
      await client.models.retrieve(model, undefined, { signal });
    },
  };
}

/** Haiku 4.5 не поддерживает параметр effort. */
export function supportsEffort(model: ClaudeModel): boolean {
  return model !== 'claude-haiku-4-5';
}

/** JSON Schema ответа (из zod-схемы через helper SDK; сам разбор — наш, после проверки stop_reason). */
function outputFormat(): { type: 'json_schema'; schema: Record<string, unknown> } {
  const { schema } = zodOutputFormat(AiOutputSchema);
  return { type: 'json_schema', schema };
}

function imageBlock(data: string): ContentBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}

/** Собирает параметры запроса: картинки → (текст источника) → инструкция. */
export function buildRequest(req: AiRequest, model: ClaudeModel): MessageCreateParamsNonStreaming {
  const content: ContentBlockParam[] = req.images.map(imageBlock);
  if (req.mode === 'dictionary') {
    content.push({ type: 'text', text: dictionaryPagePrompt() });
  } else {
    const text = req.text?.trim();
    if (text) content.push({ type: 'text', text: sourceTextBlock(text) });
    content.push({
      type: 'text',
      text: extractPrompt({ level: req.level, knownFronts: req.knownFronts, text, imageCount: req.images.length }),
    });
  }
  return {
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content }],
    output_config: {
      format: outputFormat(),
      ...(supportsEffort(model) ? { effort: 'medium' as const } : {}),
    },
  };
}

/** Проверяет stop_reason и разбирает текст ответа. */
export function readResponse(msg: AiMessage): AiItem[] {
  if (msg.stop_reason === 'refusal') {
    throw new AiError('refusal', 'ИИ отказался обрабатывать этот материал. Попробуйте другое фото или текст.');
  }
  if (msg.stop_reason === 'max_tokens' || msg.stop_reason === 'model_context_window_exceeded') {
    throw new AiError('too_long', 'Слишком много текста — разбейте на части и отправьте по очереди');
  }
  const text = msg.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new AiError('bad_response', 'ИИ вернул пустой ответ. Попробуйте ещё раз.');
  return parseAiResponse(text);
}

/** Полный цикл: запрос → проверка → разбор → фильтр уже известных слов (режим Б). Ошибки — AiError. */
export async function runAiImport(
  transport: AiTransport,
  req: AiRequest,
  model: ClaudeModel,
  signal?: AbortSignal,
): Promise<AiItem[]> {
  if (req.images.length === 0 && (req.mode === 'dictionary' || !req.text?.trim())) {
    throw new AiError('bad_request', 'Добавьте картинку или текст');
  }
  try {
    const msg = await transport.createMessage(buildRequest(req, model), signal);
    const items = readResponse(msg);
    return req.mode === 'extract' ? filterKnown(items, req.knownFronts) : items;
  } catch (err) {
    throw toAiError(err);
  }
}

export async function checkKey(transport: AiTransport, model: ClaudeModel, signal?: AbortSignal): Promise<void> {
  try {
    await transport.checkModel(model, signal);
  } catch (err) {
    throw toAiError(err);
  }
}

/** Обёртки для UI: ключ → транспорт SDK. */
export function importWithKey(apiKey: string, req: AiRequest, model: ClaudeModel, signal?: AbortSignal): Promise<AiItem[]> {
  if (!apiKey.trim()) return Promise.reject(new AiError('no_key', 'Укажите API-ключ Claude в настройках'));
  return runAiImport(createTransport(apiKey.trim()), req, model, signal);
}

export function checkKeyWithSdk(apiKey: string, model: ClaudeModel, signal?: AbortSignal): Promise<void> {
  if (!apiKey.trim()) return Promise.reject(new AiError('no_key', 'Введите ключ'));
  return checkKey(createTransport(apiKey.trim()), model, signal);
}
