import type { SettlementDto, SettlementSnapshot, SettlementStatus } from '@se/shared';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import type { z } from 'zod';
import type { createSettlementSchema } from '@se/shared';
import type { Tx } from '../db/client.js';
import { type groups, settlements } from '../db/schema.js';
import { recordEvent } from '../events/service.js';
import { balancesByGroup } from '../expenses/service.js';
import { conflict, forbidden, HttpError, notFound } from '../lib/errors.js';

type GroupRow = typeof groups.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;
type CreateInput = z.output<typeof createSettlementSchema>;

function toDto(r: SettlementRow): SettlementDto {
  return {
    id: r.id,
    groupId: r.groupId,
    fromId: r.fromId,
    toId: r.toId,
    amount: r.amount,
    comment: r.comment,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

const snapshot = (r: SettlementRow): SettlementSnapshot => ({ id: r.id, fromId: r.fromId, toId: r.toId, amount: r.amount, comment: r.comment });

/** Погашения группы: сначала ожидающие, потом остальные от новых к старым. */
export async function listSettlements(tx: Tx, groupId: string): Promise<SettlementDto[]> {
  const rows = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .orderBy(dsql`${settlements.status} = 'pending' desc`, desc(settlements.createdAt));
  return rows.map(toDto);
}

/** Сколько уже отмечено и ещё не подтверждено: от этого человека (side = from) или ему (side = to). */
async function pendingSum(tx: Tx, groupId: string, side: 'from' | 'to', userId: string): Promise<number> {
  const column = side === 'from' ? settlements.fromId : settlements.toId;
  const [row] = await tx
    .select({ sum: dsql<string>`coalesce(sum(${settlements.amount}), 0)` })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), eq(column, userId), eq(settlements.status, 'pending')));
  return Number(row?.sum ?? 0);
}

/**
 * Должник отмечает, что передал деньги. Отмечать можно только тому, кому вернут (баланс больше нуля),
 * не больше, чем с тебя сейчас, и не больше, чем вернут получателю — оба раза за вычетом уже
 * отмеченного и не подтверждённого: иначе можно было бы «погасить» больше долга. Группа заблокирована вызывающим, поэтому балансы не поменяются между проверкой и записью.
 */
export async function createSettlement(tx: Tx, group: GroupRow, fromId: string, input: CreateInput): Promise<SettlementDto> {
  if (input.toId === fromId) throw new HttpError(400, 'validation', 'Себе переводить не нужно');
  const balances = (await balancesByGroup(tx, [group.id])).get(group.id) ?? new Map<string, number>();
  const toBalance = balances.get(input.toId);
  if (toBalance === undefined) throw new HttpError(400, 'validation', 'Получатель не состоит в группе');
  if (toBalance <= 0) throw conflict('nothing_to_settle', 'Этому участнику ничего не должны вернуть');
  const owed = -(balances.get(fromId) ?? 0) - (await pendingSum(tx, group.id, 'from', fromId));
  if (owed <= 0) throw conflict('nothing_to_settle', 'С тебя ничего не осталось: всё уже отмечено или погашено');
  // И не больше, чем вернут получателю (за вычетом того, что ему уже отметили другие): иначе
  // после подтверждения получатель сам стал бы должником, хотя только платил.
  const toLeft = toBalance - (await pendingSum(tx, group.id, 'to', input.toId));
  if (input.amount > Math.min(owed, toLeft)) throw conflict('settlement_too_big', 'Это больше, чем с тебя сейчас этому человеку');

  const [row] = await tx
    .insert(settlements)
    .values({ groupId: group.id, fromId, toId: input.toId, amount: input.amount, comment: input.comment === '' ? null : input.comment })
    .returning();
  if (!row) throw new Error('Погашение не записалось');
  await recordEvent(tx, group.id, fromId, { type: 'settlement_created', settlement: snapshot(row) });
  return toDto(row);
}

/** Погашение по id; с lock — заблокированное для смены статуса (брать уже под блокировкой группы). */
export async function getSettlement(tx: Tx, id: string, opts: { lock?: boolean } = {}): Promise<SettlementRow> {
  const q = tx.select().from(settlements).where(eq(settlements.id, id));
  const [row] = opts.lock ? await q.for('update') : await q;
  if (!row) throw notFound('Погашение не найдено');
  return row;
}

const EVENT_BY_STATUS = {
  confirmed: 'settlement_confirmed',
  rejected: 'settlement_rejected',
  cancelled: 'settlement_cancelled',
} as const;

/**
 * Решение по ожидающему погашению. Подтвердить или отклонить может только получатель
 * («не засчитать то, чего не получал»), отменить свою отметку — только отдавший.
 * Повторное решение по уже решённому погашению — 409.
 */
export async function decideSettlement(tx: Tx, row: SettlementRow, userId: string, status: Exclude<SettlementStatus, 'pending'>): Promise<SettlementDto> {
  const allowed = status === 'cancelled' ? row.fromId === userId : row.toId === userId;
  if (!allowed) {
    throw forbidden(status === 'cancelled' ? 'Отменить отметку может только тот, кто её поставил' : 'Подтвердить или отклонить может только получатель');
  }
  const [updated] = await tx
    .update(settlements)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(settlements.id, row.id), inArray(settlements.status, ['pending'])))
    .returning();
  if (!updated) throw conflict('settlement_decided', 'По этому погашению уже есть решение');
  await recordEvent(tx, row.groupId, userId, { type: EVENT_BY_STATUS[status], settlement: snapshot(updated) });
  return toDto(updated);
}
