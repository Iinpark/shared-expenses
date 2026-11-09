import type { ExpenseDto, ExpenseSnapshot, GroupEventDto, GroupEventPayload, GroupEventsPage } from '@se/shared';
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { groupEvents, users } from '../db/schema.js';

/** Канал NOTIFY, по которому Postgres сообщает о новом событии (после коммита транзакции). */
export const EVENTS_CHANNEL = 'group_events';

/** Сообщение в канале: только идентификаторы, само событие сервер дочитывает из таблицы. */
export interface EventNotice {
  id: string;
  groupId: string;
}

export function snapshot(e: ExpenseDto): ExpenseSnapshot {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    amount: e.amount,
    payerId: e.payerId,
    spentOn: e.spentOn,
    shares: e.shares.map((s) => ({ userId: s.userId, amount: s.amount })),
  };
}

/**
 * Записывает событие группы в той же транзакции, что и само изменение.
 * pg_notify внутри транзакции Postgres доставит только после коммита: откатившееся
 * изменение никто не увидит, а закоммиченное увидят все подключённые участники.
 */
export async function recordEvent(tx: Tx, groupId: string, actorId: string, payload: GroupEventPayload): Promise<void> {
  const [row] = await tx.insert(groupEvents).values({ groupId, actorId, type: payload.type, payload }).returning({ id: groupEvents.id });
  if (!row) throw new Error('Событие не записалось');
  const notice: EventNotice = { id: row.id, groupId };
  await tx.execute(dsql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(notice)})`);
}

const eventColumns = {
  id: groupEvents.id,
  groupId: groupEvents.groupId,
  actorId: groupEvents.actorId,
  actorName: users.name,
  actorEmail: users.email,
  createdAt: groupEvents.createdAt,
  payload: groupEvents.payload,
};

const selectEvents = (tx: Tx) => tx.select(eventColumns).from(groupEvents).innerJoin(users, eq(users.id, groupEvents.actorId));
type EventRow = Awaited<ReturnType<typeof selectEvents>>[number];

function toDto(r: EventRow): GroupEventDto {
  return {
    id: r.id,
    groupId: r.groupId,
    actorId: r.actorId,
    actorName: r.actorName ?? r.actorEmail,
    createdAt: r.createdAt.toISOString(),
    payload: r.payload as GroupEventPayload,
  };
}

export async function getEvent(tx: Tx, id: string): Promise<GroupEventDto | null> {
  const [row] = await selectEvents(tx).where(eq(groupEvents.id, id));
  return row ? toDto(row) : null;
}

/**
 * Лента группы от новых к старым, страницами по limit. before — id последнего события прошлой страницы:
 * курсор по (время, id), а не по одному времени, чтобы события с одинаковой меткой не терялись на стыке страниц.
 */
export async function listEvents(tx: Tx, groupId: string, before: string | null, limit: number): Promise<GroupEventsPage> {
  const cursor = before
    ? dsql`(${groupEvents.createdAt}, ${groupEvents.id}) < (select created_at, id from group_events where id = ${before})`
    : undefined;
  const rows = await selectEvents(tx)
    .where(and(eq(groupEvents.groupId, groupId), cursor))
    .orderBy(desc(groupEvents.createdAt), desc(groupEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { events: page.map(toDto), nextBefore: rows.length > limit && last ? last.id : null };
}
