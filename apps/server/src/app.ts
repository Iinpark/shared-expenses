import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { HealthResponse } from '@se/shared';
import Fastify from 'fastify';
import { authRoutes } from './auth/routes.js';
import { loadUser, SESSION_COOKIE } from './auth/session.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { expenseRoutes } from './expenses/routes.js';
import { groupRoutes } from './groups/routes.js';
import { receiptRoutes } from './receipts/routes.js';
import { reportRoutes } from './reports/routes.js';
import { settlementRoutes } from './settlements/routes.js';
import { registerErrorHandler } from './lib/errors.js';
import { RealtimeHub } from './realtime/hub.js';
import { realtimeRoutes } from './realtime/routes.js';
import { registerWebStatic } from './web/static.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ? { transport: { target: 'pino-pretty', options: { ignore: 'pid,hostname' } } } : false,
    // Логи на каждый запрос в dev только мешают; ошибки всё равно пишутся.
    disableRequestLogging: true,
  });

  registerErrorHandler(app);
  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    // /api/health должен ответить «degraded», а не 500, даже если база лежит.
    // Статике клиента пользователь не нужен — не ходим за сессией в базу на каждый файл.
    if (req.url === '/api/health' || !req.url.startsWith('/api/')) return;
    req.user = await loadUser(req.cookies[SESSION_COOKIE]);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    let db: HealthResponse['db'] = 'up';
    try {
      await sql`select 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(groupRoutes);
  await app.register(expenseRoutes);
  await app.register(settlementRoutes);
  await app.register(reportRoutes);
  await app.register(receiptRoutes);

  // Реалтайм: поток событий групп пользователя (SSE).
  const hub = new RealtimeHub();
  await hub.start(app.log);
  app.addHook('onClose', async () => {
    await hub.stop();
  });
  await app.register((instance) => realtimeRoutes(instance, hub));

  if (config.webDist) await registerWebStatic(app, config.webDist);

  return app;
}
