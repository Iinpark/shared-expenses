import type { Gender } from './api.js';

/** Глагол в нужном роде: «изменил» / «изменила». Пол не указан — обе формы: «изменил(а)». */
export function byGender(gender: Gender | null | undefined, m: string, f: string): string {
  if (gender === 'f') return f;
  if (gender === 'm') return m;
  return `${m}(${f.slice(m.length) || f})`;
}

/** Первая буква имени для аватара. */
export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
