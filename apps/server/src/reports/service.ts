import { minimalTransfers, type GroupReportDto, type ReportMemberDto } from '@se/shared';
import { and, asc, eq, isNull, sql as dsql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { expenses, expenseShares, groupMembers, type groups, users } from '../db/schema.js';
import { listSettlements } from '../settlements/service.js';

type GroupRow = typeof groups.$inferSelect;

async function sumsByUser(tx: Tx, groupId: string) {
  const live = and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt));
  const paid = await tx
    .select({ userId: expenses.payerId, sum: dsql<string>`sum(${expenses.amount})` })
    .from(expenses)
    .where(live)
    .groupBy(expenses.payerId);
  const share = await tx
    .select({ userId: expenseShares.userId, sum: dsql<string>`sum(${expenseShares.amount})` })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
    .where(live)
    .groupBy(expenseShares.userId);
  const [period] = await tx
    .select({ from: dsql<string | null>`min(${expenses.spentOn})::text`, to: dsql<string | null>`max(${expenses.spentOn})::text` })
    .from(expenses)
    .where(live);
  const toMap = (rows: { userId: string; sum: string }[]) => new Map(rows.map((r) => [r.userId, Number(r.sum)]));
  const range = period?.from && period.to ? { from: period.from, to: period.to } : null;
  return { paid: toMap(paid), share: toMap(share), period: range };
}

/** Подтверждённые погашения по людям: отдал (+), получил (−). */
function settledByUser(settlements: { fromId: string; toId: string; amount: number; status: string }[]) {
  const out = new Map<string, number>();
  for (const s of settlements) {
    if (s.status !== 'confirmed') continue;
    out.set(s.fromId, (out.get(s.fromId) ?? 0) + s.amount);
    out.set(s.toId, (out.get(s.toId) ?? 0) - s.amount);
  }
  return out;
}

/**
 * Итоговый отчёт группы (D05, письмо E03): кто сколько заплатил, какая у кого доля, кто сколько
 * отдал и получил погашениями и что осталось. Считается из тех же данных, что и балансы,
 * поэтому сверка сходится: сумма «заплатил» = сумма долей = потрачено вместе, сумма итогов = 0.
 */
export async function groupReport(tx: Tx, group: GroupRow): Promise<GroupReportDto> {
  const people = await tx
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, group.id))
    .orderBy(asc(groupMembers.joinOrder));
  const { paid, share, period } = await sumsByUser(tx, group.id);
  const settlements = await listSettlements(tx, group.id);
  const settled = settledByUser(settlements);
  const members: ReportMemberDto[] = people.map((p) => {
    const row = { paid: paid.get(p.userId) ?? 0, share: share.get(p.userId) ?? 0, settled: settled.get(p.userId) ?? 0 };
    return { userId: p.userId, name: p.name ?? p.email, ...row, balance: row.paid - row.share + row.settled };
  });
  return {
    groupId: group.id,
    name: group.name,
    currency: group.currency,
    status: group.status,
    closedAt: group.closedAt?.toISOString() ?? null,
    period,
    totalSpent: members.reduce((s, m) => s + m.paid, 0),
    members,
    settlements: settlements.filter((s) => s.status === 'confirmed' || s.status === 'pending'),
    transfers: minimalTransfers(members.map((m) => ({ userId: m.userId, amount: m.balance }))),
  };
}
