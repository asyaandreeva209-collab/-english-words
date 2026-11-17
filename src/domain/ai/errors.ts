// Ошибки ИИ-импорта: типизированные классы SDK → понятный русский текст.
// Модуль тянет SDK, поэтому подключается только из client.ts (динамический import).
import Anthropic from '@anthropic-ai/sdk';
import { AiResponseFormatError } from './schema';

export type AiErrorCode =
  | 'no_key'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'rate_limit'
  | 'overloaded'
  | 'network'
  | 'too_large'
  | 'bad_request'
  | 'api'
  | 'refusal'
  | 'too_long'
  | 'bad_response'
  | 'aborted'
  | 'unknown';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiError';
  }
}

/** Любую ошибку вызова → AiError с сообщением для пользователя. Порядок проверок важен: подклассы раньше. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const opt = { cause: err };
  if (err instanceof AiResponseFormatError) return new AiError('bad_response', `${err.message}. Попробуйте ещё раз.`, opt);
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('aborted', 'Запрос отменён', opt);
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('network', 'Сервер слишком долго не отвечает. Проверьте интернет и попробуйте ещё раз.', opt);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AiError('network', 'Нет сети или сервер недоступен', opt);
  if (err instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Неверный API-ключ. Проверьте его в настройках.', opt);
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('permission', 'У ключа нет доступа к этой модели или закончились средства на счёте', opt);
  }
  if (err instanceof Anthropic.NotFoundError) return new AiError('not_found', 'Модель недоступна — выберите другую в настройках', opt);
  if (err instanceof Anthropic.RateLimitError) return new AiError('rate_limit', 'Слишком много запросов, подождите минуту', opt);
  if (err instanceof Anthropic.ContentTooLargeError) {
    return new AiError('too_large', 'Слишком большой запрос — уберите часть картинок или текста', opt);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError('bad_request', 'Сервер отклонил запрос (возможно, закончились средства на счёте или картинка не подходит)', opt);
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError('overloaded', 'Сервер Claude перегружен или недоступен, попробуйте позже', opt);
  }
  if (err instanceof Anthropic.APIError) return new AiError('api', 'Ошибка сервера Claude, попробуйте позже', opt);
  return new AiError('unknown', 'Не удалось обработать запрос', opt);
}
