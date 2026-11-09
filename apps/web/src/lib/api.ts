import type { ApiErrorBody } from '@se/shared';

/** Ошибка API с машинным кодом и текстом для пользователя. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Всё тело ответа: в нём бывают дополнительные поля (например, текущая версия расхода при 409). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function send(method: string, path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `Ошибка ${String(res.status)}`, data);
  }
  return data as T;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Что-то пошло не так');
