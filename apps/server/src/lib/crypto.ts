import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Случайный токен без похожих символов (l/1, O/0): удобно читать в ссылке. */
export function randomToken(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Шестизначный код входа. */
export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Хеш кода привязан к почте и секрету сервера: по дампу базы код не подобрать для другой почты. */
export const hashCode = (email: string, code: string) =>
  createHmac('sha256', config.secret).update(`${email}:${code}`).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
