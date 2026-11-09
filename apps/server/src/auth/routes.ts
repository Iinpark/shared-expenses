import { must } from '@se/shared';
import { requestCodeSchema, updateProfileSchema, verifyCodeSchema, type Me } from '@se/shared';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { loginCodes, users } from '../db/schema.js';
import { generateCode, hashCode, safeEqual } from '../lib/crypto.js';
import { HttpError, parse } from '../lib/errors.js';
import { enqueueEmail } from '../mail/outbox.js';
import { loginCodeEmail } from '../mail/templates.js';
import { createSession, destroySession, requireUser } from './session.js';

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
/** Не больше N кодов на почту за окно: защита от рассылки писем на чужой адрес. */
const CODES_PER_WINDOW = 5;
const CODE_WINDOW_MS = 15 * 60_000;

export function authRoutes(app: FastifyInstance): Promise<void> {
  /** Шаг 1: прислать код на почту. Аккаунт создаётся при первом успешном вводе кода. */
  app.post('/api/auth/request-code', async (req, reply) => {
    const { email } = parse(requestCodeSchema, req.body);

    await db.transaction(async (tx) => {
      const [recent] = await tx
        .select({ n: count() })
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, new Date(Date.now() - CODE_WINDOW_MS))));
      if ((recent?.n ?? 0) >= CODES_PER_WINDOW) {
        throw new HttpError(429, 'too_many_codes', 'Слишком много кодов подряд. Подожди 15 минут или проверь почту ещё раз.');
      }

      // Новый код отменяет предыдущие: действует только последний.
      await tx
        .update(loginCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)));

      const code = generateCode();
      const [row] = await tx
        .insert(loginCodes)
        .values({ email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) })
        .returning({ id: loginCodes.id });
      await enqueueEmail(tx, `login:${must(row).id}`, loginCodeEmail(email, code));
      req.log.info({ email }, 'login code queued');
    });

    return reply.status(204).send();
  });

  /** Шаг 2: проверить код, создать пользователя при первом входе, выдать сессию. */
  app.post('/api/auth/verify', async (req, reply) => {
    const { email, code } = parse(verifyCodeSchema, req.body);

    const me = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(loginCodes)
        .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
        .orderBy(desc(loginCodes.createdAt))
        .limit(1)
        .for('update');

      if (!row) throw new HttpError(400, 'code_expired', 'Код устарел. Запроси новый.');
      if (row.attempts >= MAX_CODE_ATTEMPTS) throw new HttpError(400, 'code_locked', 'Слишком много попыток. Запроси новый код.');

      if (!safeEqual(row.codeHash, hashCode(email, code))) {
        await tx.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));
        return null;
      }
      await tx.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));

      const [user] = await tx
        .insert(users)
        .values({ email })
        .onConflictDoUpdate({ target: users.email, set: { email } })
        .returning({ id: users.id, email: users.email, name: users.name, gender: users.gender });
      const me = must(user, 'пользователь');
      await createSession(tx, me.id, reply);
      return me;
    });

    // Неверный код: счётчик попыток уже сохранён, транзакция закоммичена.
    if (!me) throw new HttpError(400, 'code_invalid', 'Код не подходит. Проверь цифры в письме.');
    return me satisfies Me;
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.status(204).send();
  });

  app.get('/api/me', (req) => requireUser(req) satisfies Me);

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const { name, gender } = parse(updateProfileSchema, req.body);
    const [updated] = await db
      .update(users)
      .set({ name, gender })
      .where(eq(users.id, user.id))
      .returning({ id: users.id, email: users.email, name: users.name, gender: users.gender });
    return must(updated, 'пользователь') satisfies Me;
  });
  return Promise.resolve();
}
