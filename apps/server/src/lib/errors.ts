import type { ApiErrorBody } from '@se/shared';
import type { FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';

/** Ошибка с HTTP-статусом и машинным кодом. Текст сообщения показывается пользователю. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Дополнительные поля в теле ответа (например, текущая версия расхода при конфликте). */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (message = 'Не нашли') => new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Это может сделать только создатель группы') =>
  new HttpError(403, 'forbidden', message);
export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpError(409, code, message, extra);

/** Разбирает тело запроса по zod-схеме; ошибка превращается в 400 с понятным текстом. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message }, ...err.extra } satisfies ApiErrorBody);
    }
    if (err instanceof ZodError) {
      const message = err.issues[0]?.message ?? 'Неверные данные';
      return reply.status(400).send({ error: { code: 'validation', message } } satisfies ApiErrorBody);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: (err as Error).message } } satisfies ApiErrorBody);
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Что-то сломалось на сервере' } } satisfies ApiErrorBody);
  });
}
