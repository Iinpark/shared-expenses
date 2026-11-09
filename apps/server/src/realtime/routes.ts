import type { GroupEventDto } from '@se/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { db } from '../db/client.js';
import { eventsSince } from '../events/service.js';
import type { RealtimeHub } from './hub.js';

/** Пустая строка-комментарий раз в 25 секунд: прокси не закрывают «молчащее» соединение. */
const HEARTBEAT_MS = 25_000;

const lastEventId = z.uuid().optional().catch(undefined);

const frame = (event: GroupEventDto) => `id: ${event.id}\nevent: group_event\ndata: ${JSON.stringify(event)}\n\n`;

/**
 * Поток событий групп (Server-Sent Events). Данные идут только от сервера к браузеру,
 * поэтому хватает обычного HTTP: EventSource сам переподключается и присылает Last-Event-ID,
 * а сервер досылает пропущенное из ленты. Если досылать нечего с уверенностью — событие resync,
 * клиент перезагружает данные целиком.
 */
export function realtimeRoutes(app: FastifyInstance, hub: RealtimeHub): Promise<void> {
  app.get('/api/events/stream', async (req, reply) => {
    const user = requireProfile(req);
    // Сам EventSource при переподключении шлёт заголовок; новый EventSource (клиент открыл поток
    // заново после потери сети) заголовок задать не может и передаёт id в адресе.
    const query = req.query as { lastEventId?: unknown };
    const since = lastEventId.parse(req.headers['last-event-id'] ?? query.lastEventId);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Чтобы nginx и подобные не копили поток в буфере.
      'x-accel-buffering': 'no',
    });

    // Подписываемся до досылки, а живые события копим, пока она идёт: так между «досланным»
    // и «живым» не будет ни дыры, ни повторов (повторы отсекаются по id).
    const sent = new Set<string>();
    let buffer: GroupEventDto[] | null = [];
    const write = (event: GroupEventDto) => {
      if (sent.has(event.id)) return;
      sent.add(event.id);
      res.write(frame(event));
    };
    const unsubscribe = hub.add(user.id, {
      send: (event) => {
        if (buffer) buffer.push(event);
        else write(event);
      },
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    res.write('retry: 3000\n\n');
    if (since) {
      const missed = await eventsSince(db, user.id, since);
      if (missed) missed.forEach(write);
      else res.write('event: resync\ndata: {}\n\n');
    }
    for (const event of buffer) write(event);
    buffer = null;
    res.write('event: ready\ndata: {}\n\n');
  });
  return Promise.resolve();
}
