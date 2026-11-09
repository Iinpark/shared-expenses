import type { Me } from '@se/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { Tx } from '../db/client.js';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

export const SESSION_COOKIE = 'sid';
const SESSION_TTL_DAYS = 30;

export type SessionUser = Me;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function createSession(tx: Tx, userId: string, reply: FastifyReply) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await tx.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Находит пользователя по cookie. Вызывается для каждого запроса (хук onRequest). */
export async function loadUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, gender: users.gender })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Требует вход. Возвращает пользователя или бросает 401. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Нужно войти');
  return req.user;
}

/** Требует вход и заполненное имя: без имени человека нельзя показать другим участникам. */
export function requireProfile(req: FastifyRequest): SessionUser & { name: string } {
  const user = requireUser(req);
  if (!user.name) throw new HttpError(403, 'profile_required', 'Сначала представься');
  return user as SessionUser & { name: string };
}
