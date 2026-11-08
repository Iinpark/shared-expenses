import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { HealthResponse } from '@se/shared';
import Fastify from 'fastify';
import { config } from './config.js';
import { sql } from './db/client.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ? { transport: { target: 'pino-pretty' } } : false,
  });

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(websocket);

  app.get('/api/health', async (): Promise<HealthResponse> => {
    let db: HealthResponse['db'] = 'up';
    try {
      await sql`select 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  });

  // Канал реалтайм-событий. Пока только приветствие; события групп появятся позже.
  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'hello', time: new Date().toISOString() }));
  });

  return app;
}
