import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { HealthResponse, WsServerMessage } from '@se/shared';
import Fastify from 'fastify';
import { authRoutes } from './auth/routes.js';
import { loadUser, SESSION_COOKIE } from './auth/session.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { expenseRoutes } from './expenses/routes.js';
import { groupRoutes } from './groups/routes.js';
import { registerErrorHandler } from './lib/errors.js';
import { RealtimeHub } from './realtime/hub.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ? { transport: { target: 'pino-pretty', options: { ignore: 'pid,hostname' } } } : false,
    // Логи на каждый запрос в dev только мешают; ошибки всё равно пишутся.
    disableRequestLogging: true,
  });

  registerErrorHandler(app);
  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(websocket);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    // /api/health должен ответить «degraded», а не 500, даже если база лежит.
    if (req.url === '/api/health') return;
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

  // Реалтайм: события групп, где состоит пользователь. Только для вошедших и только со своего сайта:
  // браузер шлёт cookie и в WebSocket, поэтому чужой origin отклоняем (защита от подмены сайта).
  const hub = new RealtimeHub();
  await hub.start(app.log);
  app.addHook('onClose', async () => {
    await hub.stop();
  });
  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (!req.user || (origin && origin !== config.webOrigin)) {
      socket.close(4401, 'unauthorized');
      return;
    }
    hub.add(req.user.id, socket);
    socket.send(JSON.stringify({ type: 'hello', time: new Date().toISOString() } satisfies WsServerMessage));
  });

  return app;
}
