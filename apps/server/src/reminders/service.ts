import { minimalTransfers } from '@se/shared';
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import type { Db, Tx } from '../db/client.js';
import { groupMembers, groups, settlements, users } from '../db/schema.js';
import { balancesByGroup } from '../expenses/service.js';
import { enqueueEmail } from '../mail/outbox.js';
import { reminderEmail } from '../mail/templates.js';

const DAY_MS = 86_400_000;
/** Не чаще раза в неделю (ТЗ). */
export const REMINDER_EVERY_MS = 7 * DAY_MS;

type GroupRow = typeof groups.$inferSelect;
interface MemberRow {
  userId: string;
  name: string;
  email: string;
  debtSince: Date | null;
  lastRemindedAt: Date | null;
}

const groupUrl = (groupId: string) => `${config.webOrigin}/groups/${groupId}`;

async function members(tx: Tx, groupId: string): Promise<MemberRow[]> {
  const rows = await tx
    .select({ userId: users.id, name: users.name, email: users.email, debtSince: groupMembers.debtSince, lastRemindedAt: groupMembers.lastRemindedAt })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));
  return rows.map((r) => ({ ...r, name: r.name ?? r.email }));
}

async function pendingByDebtor(tx: Tx, groupId: string) {
  const rows = await tx
    .select({ fromId: settlements.fromId, toId: settlements.toId, amount: settlements.amount, createdAt: settlements.createdAt })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), eq(settlements.status, 'pending')));
  const out = new Map<string, typeof rows>();
  for (const r of rows) out.set(r.fromId, [...(out.get(r.fromId) ?? []), r]);
  return out;
}

const setMember = (tx: Tx, groupId: string, userId: string, values: { debtSince?: Date | null; lastRemindedAt?: Date }) =>
  tx
    .update(groupMembers)
    .set(values)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));

/**
 * Пора ли напоминать: в минусе дольше срока группы, с прошлого письма прошла неделя,
 * и уже отмеченные погашения не покрывают долг целиком (ждём, пока получатель подтвердит).
 */
function isDue(m: MemberRow, debt: number, pendingTotal: number, group: GroupRow, now: Date): boolean {
  if (!m.debtSince) return false;
  const overdue = now.getTime() - m.debtSince.getTime() >= group.reminderDays * DAY_MS;
  const quiet = !m.lastRemindedAt || now.getTime() - m.lastRemindedAt.getTime() >= REMINDER_EVERY_MS;
  return overdue && quiet && pendingTotal < debt;
}

/**
 * Отметка «в минусе с …»: ставится при первом обнаружении долга и снимается, как только он погашен.
 * true — человек в минусе уже не первую проверку, можно решать про письмо.
 */
async function trackDebt(tx: Tx, groupId: string, m: MemberRow, debt: number, now: Date): Promise<boolean> {
  if (debt <= 0) {
    if (m.debtSince) await setMember(tx, groupId, m.userId, { debtSince: null });
    return false;
  }
  if (!m.debtSince) {
    await setMember(tx, groupId, m.userId, { debtSince: now });
    return false;
  }
  return true;
}

/** Одна группа под блокировкой: два экземпляра проверки не отправят одно письмо дважды. */
async function remindGroup(tx: Tx, groupId: string, now: Date): Promise<number> {
  const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('update');
  if (group?.status !== 'open') return 0;
  const balances = (await balancesByGroup(tx, [groupId])).get(groupId) ?? new Map<string, number>();
  const list = await members(tx, groupId);
  const nameOf = (id: string) => list.find((m) => m.userId === id)?.name ?? '';
  const transfers = minimalTransfers([...balances].map(([userId, amount]) => ({ userId, amount })));
  const pending = await pendingByDebtor(tx, groupId);
  let sent = 0;

  for (const m of list) {
    const debt = -(balances.get(m.userId) ?? 0);
    if (!(await trackDebt(tx, groupId, m, debt, now))) continue;
    const mine = pending.get(m.userId) ?? [];
    if (!isDue(m, debt, mine.reduce((s, p) => s + p.amount, 0), group, now)) continue;

    await enqueueEmail(
      tx,
      `reminder:${groupId}:${m.userId}:${String(Math.floor(now.getTime() / REMINDER_EVERY_MS))}`,
      reminderEmail({
        to: m.email,
        name: m.name,
        groupName: group.name,
        currency: group.currency,
        days: group.reminderDays,
        debt,
        recipients: transfers.filter((t) => t.fromId === m.userId).map((t) => ({ name: nameOf(t.toId), amount: t.amount })),
        pending: mine.map((p) => ({ name: nameOf(p.toId), amount: p.amount, createdAt: p.createdAt })),
        ownerName: nameOf(group.ownerId),
        url: groupUrl(groupId),
      }),
    );
    await setMember(tx, groupId, m.userId, { lastRemindedAt: now });
    sent++;
  }
  return sent;
}

/**
 * Проверка напоминаний по всем открытым группам. Возвращает число поставленных в очередь писем.
 * Отдельно для каждой группы, в своей транзакции: ошибка в одной группе не останавливает остальные.
 */
export async function runReminders(db: Db, now = new Date()): Promise<number> {
  const open = await db.select({ id: groups.id }).from(groups).where(eq(groups.status, 'open'));
  let total = 0;
  for (const { id } of open) total += await db.transaction((tx) => remindGroup(tx, id, now));
  return total;
}

/** Фоновая проверка раз в intervalMs. Возвращает функцию остановки. */
export function startReminderWorker(db: Db, log: { error: (o: unknown, m?: string) => void }, intervalMs = 60_000) {
  const timer = setInterval(() => {
    runReminders(db).catch((err: unknown) => {
      log.error(err, 'reminders failed');
    });
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
