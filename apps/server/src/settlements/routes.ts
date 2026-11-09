import { createSettlementSchema } from '@se/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { db } from '../db/client.js';
import { assertOpen, getMemberGroup } from '../groups/service.js';
import { parse } from '../lib/errors.js';
import { createSettlement, decideSettlement, getSettlement, listSettlements } from './service.js';

const groupParams = z.object({ id: z.uuid({ message: 'Группа не найдена' }) });
const settlementParams = z.object({ id: z.uuid({ message: 'Погашение не найдено' }), action: z.enum(['confirm', 'reject', 'cancel']) });

const STATUS_BY_ACTION = { confirm: 'confirmed', reject: 'rejected', cancel: 'cancelled' } as const;

/** Погашения (M07, M08, S01). Все изменения — под блокировкой группы, как и у расходов. */
export function settlementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups/:id/settlements', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(groupParams, req.params);
    return db.transaction(async (tx) => {
      await getMemberGroup(tx, id, user.id);
      return listSettlements(tx, id);
    });
  });

  app.post('/api/groups/:id/settlements', async (req, reply) => {
    const user = requireProfile(req);
    const { id } = parse(groupParams, req.params);
    const input = parse(createSettlementSchema, req.body);
    const dto = await db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOpen(group);
      return createSettlement(tx, group, user.id, input);
    });
    return reply.status(201).send(dto);
  });

  app.post('/api/settlements/:id/:action', async (req) => {
    const user = requireProfile(req);
    const { id, action } = parse(settlementParams, req.params);
    return db.transaction(async (tx) => {
      // Сначала группа (под блокировкой, и заодно проверка, что пользователь в ней), потом само погашение.
      const found = await getSettlement(tx, id);
      const group = await getMemberGroup(tx, found.groupId, user.id, { lock: true });
      assertOpen(group);
      return decideSettlement(tx, await getSettlement(tx, id, { lock: true }), user.id, STATUS_BY_ACTION[action]);
    });
  });
  return Promise.resolve();
}
