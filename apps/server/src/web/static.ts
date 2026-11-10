import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';

/**
 * Раздаёт собранный клиент (apps/web/dist) с того же порта, что и API: так приложение
 * в Docker запускается одним сервисом, без отдельного веб-сервера и прокси для SSE.
 * Любой неизвестный GET вне /api отдаёт index.html — маршруты решает клиентский роутер.
 */
export async function registerWebStatic(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, { root, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    throw notFound();
  });
}
