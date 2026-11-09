import { must } from '@se/shared';
import {
  computeShares,
  minimalTransfers,
  SplitError,
  type BalancesDto,
  type ExpenseDto,
  type ExpenseShareDto,
  type ReceiptDto,
  type expenseInputSchema } from '@se/shared';
import { and, asc, desc, eq, inArray, isNull, sql as dsql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Tx } from '../db/client.js';
import { expenses, expenseShares, groupMembers, groups } from '../db/schema.js';
import { recordEvent, snapshot } from '../events/service.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';

type GroupRow = typeof groups.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
export type ExpenseInput = z.output<typeof expenseInputSchema>;

/** Порядок вступления участников группы: по нему раздаются лишние копейки. */
async function joinOrder(tx: Tx, groupId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ userId: groupMembers.userId, joinOrder: groupMembers.joinOrder })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return new Map(rows.map((r) => [r.userId, r.joinOrder]));
}

/** Проверяет плательщика и считает доли тем же кодом, что и превью в форме. */
async function prepare(tx: Tx, groupId: string, input: ExpenseInput) {
  const order = await joinOrder(tx, groupId);
  if (!order.has(input.payerId)) throw new HttpError(400, 'validation', 'Платить может только участник группы');
  try {
    return computeShares(input.amount, input.split, order);
  } catch (err) {
    if (err instanceof SplitError) throw new HttpError(400, 'validation', err.message);
    throw err;
  }
}

async function sharesOf(tx: Tx, expenseIds: string[]): Promise<Map<string, ExpenseShareDto[]>> {
  const out = new Map<string, ExpenseShareDto[]>();
  if (!expenseIds.length) return out;
  const rows = await tx
    .select({ expenseId: expenseShares.expenseId, userId: expenseShares.userId, amount: expenseShares.amount, weight: expenseShares.weight })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
    .leftJoin(groupMembers, and(eq(groupMembers.groupId, expenses.groupId), eq(groupMembers.userId, expenseShares.userId)))
    .where(inArray(expenseShares.expenseId, expenseIds))
    .orderBy(asc(groupMembers.joinOrder));
  for (const { expenseId, ...share } of rows) out.set(expenseId, [...(out.get(expenseId) ?? []), share]);
  return out;
}

function toDto(e: ExpenseRow, shares: ExpenseShareDto[]): ExpenseDto {
  return {
    id: e.id,
    groupId: e.groupId,
    amount: e.amount,
    title: e.title,
    category: e.category,
    payerId: e.payerId,
    spentOn: e.spentOn,
    comment: e.comment,
    splitMode: e.splitMode,
    shares,
    version: e.version,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt.toISOString(),
    receipt:
      e.receiptFile && e.receiptName && e.receiptType && e.receiptSize !== null
        ? { name: e.receiptName, type: e.receiptType as ReceiptDto['type'], size: e.receiptSize }
        : null,
  };
}

export async function expenseDto(tx: Tx, e: ExpenseRow): Promise<ExpenseDto> {
  return toDto(e, (await sharesOf(tx, [e.id])).get(e.id) ?? []);
}

/** Расходы группы: сначала новые по дате траты, при равной дате — недавно добавленные. */
export async function listExpenses(tx: Tx, groupId: string): Promise<ExpenseDto[]> {
  const rows = await tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
  const shares = await sharesOf(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDto(r, shares.get(r.id) ?? []));
}

/** Есть ли в группе расходы (удалённые не в счёт). Пока нет — валюту группы можно поменять. */
export async function hasExpenses(tx: Tx, groupId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .limit(1);
  return !!row;
}

/**
 * Расход и его группа, если пользователь в ней состоит. Иначе 404, как и с группами.
 * Удалённый расход тоже 404.
 */
export async function getMemberExpense(tx: Tx, expenseId: string, userId: string) {
  const [row] = await tx
    .select({ expense: expenses, group: groups })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(expenses.id, expenseId), isNull(expenses.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Расход не найден');
  return row;
}

async function writeShares(tx: Tx, expenseId: string, shares: ReturnType<typeof computeShares>) {
  await tx.insert(expenseShares).values(shares.map((s) => ({ expenseId, userId: s.userId, amount: s.amount, weight: s.weight })));
}

export async function createExpense(tx: Tx, group: GroupRow, userId: string, input: ExpenseInput): Promise<ExpenseDto> {
  const shares = await prepare(tx, group.id, input);
  const [row] = await tx
    .insert(expenses)
    .values({
      groupId: group.id,
      payerId: input.payerId,
      amount: input.amount,
      title: input.title,
      category: input.category,
      spentOn: input.spentOn,
      comment: input.comment === '' ? null : input.comment,
      splitMode: input.split.mode,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();
  await writeShares(tx, must(row).id, shares);
  const dto = await expenseDto(tx, must(row));
  await recordEvent(tx, group.id, userId, { type: 'expense_created', after: snapshot(dto) });
  return dto;
}

/** Конфликт версий: в ответе то, что сейчас в базе, чтобы клиент показал обе версии. */
async function versionConflict(tx: Tx, expenseId: string): Promise<HttpError> {
  const [current] = await tx.select().from(expenses).where(eq(expenses.id, expenseId));
  if (!current || current.deletedAt) {
    return conflict('expense_deleted', 'Этот расход уже удалили, пока была открыта форма', { current: null });
  }
  return conflict('version_conflict', 'Этот расход уже изменили, пока была открыта форма', { current: await expenseDto(tx, current) });
}

/**
 * Правка. Обновление проходит, только если версия в базе всё ещё та, с которой человек начал править:
 * условие version = N в самом UPDATE, поэтому из двух одновременных правок пройдёт ровно одна.
 */
export async function updateExpense(
  tx: Tx,
  group: GroupRow,
  expenseId: string,
  userId: string,
  input: ExpenseInput & { version: number },
): Promise<ExpenseDto> {
  const shares = await prepare(tx, group.id, input);
  // Снимок «до» для ленты и тоста. Группа заблокирована вызывающим, поэтому он не устареет до UPDATE.
  const [current] = await tx.select().from(expenses).where(eq(expenses.id, expenseId));
  const before = current ? await expenseDto(tx, current) : null;
  const [row] = await tx
    .update(expenses)
    .set({
      payerId: input.payerId,
      amount: input.amount,
      title: input.title,
      category: input.category,
      spentOn: input.spentOn,
      comment: input.comment === '' ? null : input.comment,
      splitMode: input.split.mode,
      version: dsql`${expenses.version} + 1`,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(expenses.id, expenseId), eq(expenses.version, input.version), isNull(expenses.deletedAt)))
    .returning();
  if (!row) throw await versionConflict(tx, expenseId);
  await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
  await writeShares(tx, expenseId, shares);
  const after = await expenseDto(tx, row);
  if (before) await recordEvent(tx, group.id, userId, { type: 'expense_updated', before: snapshot(before), after: snapshot(after) });
  return after;
}

/**
 * Удаление (мягкое). Тоже по версии: нельзя удалить расход, который кто-то только что поменял, не увидев правку.
 * Возвращает имя файла чека, который больше не нужен: вызывающий удалит его с диска после коммита.
 */
export async function deleteExpense(tx: Tx, expenseId: string, userId: string, version: number): Promise<string | null> {
  const [current] = await tx.select({ receiptFile: expenses.receiptFile }).from(expenses).where(eq(expenses.id, expenseId));
  const [row] = await tx
    .update(expenses)
    .set({
      deletedAt: new Date(),
      updatedBy: userId,
      updatedAt: new Date(),
      version: dsql`${expenses.version} + 1`,
      receiptFile: null,
      receiptName: null,
      receiptType: null,
      receiptSize: null,
    })
    .where(and(eq(expenses.id, expenseId), eq(expenses.version, version), isNull(expenses.deletedAt)))
    .returning();
  if (!row) throw await versionConflict(tx, expenseId);
  // Доли при мягком удалении остаются в базе, поэтому снимок полный.
  await recordEvent(tx, row.groupId, userId, { type: 'expense_deleted', before: snapshot(await expenseDto(tx, row)) });
  return current?.receiptFile ?? null;
}

/**
 * Балансы участников групп: заплатил за всех минус сумма своих долей, плюс подтверждённые погашения.
 * Считаются каждый раз из расходов (решение 4 в DECISIONS), в базе не хранятся.
 * Возвращает groupId → (userId → баланс); участники без расходов имеют 0.
 */
export async function balancesByGroup(tx: Tx, groupIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>(groupIds.map((id) => [id, new Map()]));
  if (!groupIds.length) return out;
  // Один запрос, а не три: внутри одного SQL-запроса Postgres видит один снимок данных,
  // поэтому расход, сохранённый в эту же миллисекунду, не попадёт в «заплатил», минуя «доли».
  // Участники идут с нулём, чтобы были и те, у кого расходов нет.
  const ids = dsql.join(
    groupIds.map((id) => dsql`${id}::uuid`),
    dsql`, `,
  );
  const rows = await tx.execute<{ group_id: string; user_id: string; balance: string }>(dsql`
    with parts as (
      select gm.group_id, gm.user_id, 0::bigint as amount, gm.join_order
        from group_members gm where gm.group_id in (${ids})
      union all
      select e.group_id, e.payer_id, e.amount, null
        from expenses e where e.group_id in (${ids}) and e.deleted_at is null
      union all
      select e.group_id, s.user_id, -s.amount, null
        from expense_shares s join expenses e on e.id = s.expense_id
       where e.group_id in (${ids}) and e.deleted_at is null
      union all
      -- Подтверждённое погашение: отдавшему с него меньше (+), получившему вернут меньше (−).
      select st.group_id, st.from_id, st.amount, null
        from settlements st where st.group_id in (${ids}) and st.status = 'confirmed'
      union all
      select st.group_id, st.to_id, -st.amount, null
        from settlements st where st.group_id in (${ids}) and st.status = 'confirmed'
    )
    select group_id, user_id, sum(amount)::text as balance
      from parts
     group by group_id, user_id
     order by group_id, min(join_order) nulls last, user_id
  `);
  for (const r of rows) out.get(r.group_id)?.set(r.user_id, Number(r.balance));

  for (const [groupId, m] of out) {
    const sum = [...m.values()].reduce((s, v) => s + v, 0);
    // Сумма балансов группы обязана быть нулём (HANDOFF, правило 5). Если нет — это баг, пишем в лог.
    if (sum !== 0) console.error(`[balances] группа ${groupId}: сумма балансов ${sum}, а должна быть 0`);
  }
  return out;
}

export async function groupBalances(tx: Tx, groupId: string): Promise<BalancesDto> {
  const map = (await balancesByGroup(tx, [groupId])).get(groupId) ?? new Map<string, number>();
  const balances = [...map].map(([userId, amount]) => ({ userId, amount }));
  const [totals] = await tx
    .select({ total: dsql<string>`coalesce(sum(${expenses.amount}), 0)`, count: dsql<number>`count(*)`.mapWith(Number) })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
  return { balances, transfers: minimalTransfers(balances), totalSpent: Number(must(totals).total), expenseCount: must(totals).count };
}
