import { canEditExpense, expenseInputSchema, expenseUpdateSchema } from '@se/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { db, type Tx } from '../db/client.js';
import { forbidden, parse } from '../lib/errors.js';
import { assertOpen, getMemberGroup } from '../groups/service.js';
import {
  createExpense,
  deleteExpense,
  expenseDto,
  getMemberExpense,
  groupBalances,
  listExpenses,
  updateExpense,
} from './service.js';

/**
 * Блокирует группу расхода и уже под блокировкой перечитывает сам расход: права проверяются
 * по его актуальному плательщику и автору, а не по тому, что было до чужой правки.
 */
async function lockExpenseGroup(tx: Tx, expenseId: string, userId: string) {
  const { group } = await getMemberExpense(tx, expenseId, userId);
  await getMemberGroup(tx, group.id, userId, { lock: true });
  return getMemberExpense(tx, expenseId, userId);
}

/** Менять и удалять расход могут плательщик, автор и создатель группы (DECISIONS, раздел 15). */
function assertCanEdit(expense: { payerId: string; createdBy: string }, userId: string, group: { ownerId: string }) {
  if (!canEditExpense(expense, userId, group.ownerId)) {
    throw forbidden('Изменить расход может тот, кто платил, кто его внёс, или создатель группы');
  }
}

const groupParams = z.object({ id: z.uuid({ message: 'Группа не найдена' }) });
const expenseParams = z.object({ id: z.uuid({ message: 'Расход не найден' }) });
const versionQuery = z.object({ version: z.coerce.number().int().positive() });

/**
 * Расходы. Добавлять, править и удалять может любой участник открытой группы:
 * расходы вносит тот, кто платил, или тот, у кого под рукой телефон. Кто что поменял, видно в ленте.
 */
export function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups/:id/expenses', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(groupParams, req.params);
    return db.transaction(async (tx) => {
      await getMemberGroup(tx, id, user.id);
      return listExpenses(tx, id);
    });
  });

  app.get('/api/groups/:id/balances', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(groupParams, req.params);
    return db.transaction(async (tx) => {
      await getMemberGroup(tx, id, user.id);
      return groupBalances(tx, id);
    });
  });

  app.post('/api/groups/:id/expenses', async (req, reply) => {
    const user = requireProfile(req);
    const { id } = parse(groupParams, req.params);
    const input = parse(expenseInputSchema, req.body);
    const dto = await db.transaction(async (tx) => {
      // Блокировка строки группы: расход не проскочит в группу, которую в этот момент закрывают.
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOpen(group);
      return createExpense(tx, group, user.id, input);
    });
    return reply.status(201).send(dto);
  });

  app.get('/api/expenses/:id', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(expenseParams, req.params);
    return db.transaction(async (tx) => expenseDto(tx, (await getMemberExpense(tx, id, user.id)).expense));
  });

  app.put('/api/expenses/:id', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(expenseParams, req.params);
    const input = parse(expenseUpdateSchema, req.body);
    return db.transaction(async (tx) => {
      const locked = await lockExpenseGroup(tx, id, user.id);
      assertOpen(locked.group);
      assertCanEdit(locked.expense, user.id, locked.group);
      return updateExpense(tx, locked.group, id, user.id, input);
    });
  });

  app.delete('/api/expenses/:id', async (req, reply) => {
    const user = requireProfile(req);
    const { id } = parse(expenseParams, req.params);
    const { version } = parse(versionQuery, req.query);
    await db.transaction(async (tx) => {
      const locked = await lockExpenseGroup(tx, id, user.id);
      assertOpen(locked.group);
      assertCanEdit(locked.expense, user.id, locked.group);
      await deleteExpense(tx, id, user.id, version);
    });
    return reply.status(204).send();
  });
  return Promise.resolve();
}
