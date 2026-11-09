import type { GroupDto, GroupSummaryDto, InvitePreviewDto, MemberDto } from '@se/shared';
import { must } from '@se/shared';
import { and, asc, eq, gt, inArray, isNull, lte, sql as dsql } from 'drizzle-orm';
import { config } from '../config.js';
import type { Tx } from '../db/client.js';
import { groupMembers, groups, invites, users } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { recordEvent } from '../events/service.js';
import { balancesByGroup, hasExpenses } from '../expenses/service.js';
import { conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { enqueueEmail } from '../mail/outbox.js';
import { inviteEmail } from '../mail/templates.js';

/** Ссылка живёт две недели: старая ссылка не должна годами ходить по чатам. */
const INVITE_TTL_MS = 14 * 86_400_000;

/** Сколько приглашений по почте один человек может разослать за сутки: защита от рассылки спама через приложение. */
const EMAIL_INVITES_PER_DAY = 100;

const inviteUrl = (token: string) => `${config.webOrigin}/j/${token}`;

type GroupRow = typeof groups.$inferSelect;

/** Группа, если пользователь в ней состоит. Иначе 404: чужие группы не видны даже по id. */
export async function getMemberGroup(tx: Tx, groupId: string, userId: string, opts: { lock?: boolean } = {}): Promise<GroupRow> {
  const q = tx
    .select({ group: groups })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(eq(groups.id, groupId))
    .limit(1);
  const [row] = opts.lock ? await q.for('update', { of: groups }) : await q;
  if (!row) throw notFound('Группа не найдена');
  return row.group;
}

export function assertOwner(group: GroupRow, userId: string) {
  if (group.ownerId !== userId) throw forbidden();
}

export function assertOpen(group: GroupRow) {
  if (group.status === 'closed') throw conflict('group_closed', 'Группа закрыта. Сначала открой её снова.');
}

async function listMembers(tx: Tx, groupId: string, ownerId: string): Promise<MemberDto[]> {
  const rows = await tx
    .select({ userId: users.id, name: users.name, gender: users.gender, email: users.email, joinOrder: groupMembers.joinOrder })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinOrder));
  return rows.map((r) => ({ ...r, name: r.name ?? r.email, isOwner: r.userId === ownerId }));
}

/**
 * Добавляет участника. Строка группы уже заблокирована вызывающим (FOR UPDATE),
 * поэтому два одновременных вступления получат разные join_order.
 * Повторное вступление ничего не меняет.
 */
async function addMember(tx: Tx, groupId: string, userId: string) {
  const [next] = await tx
    .select({ n: dsql<number>`coalesce(max(${groupMembers.joinOrder}), 0) + 1`.mapWith(Number) })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const joined = await tx
    .insert(groupMembers)
    .values({ groupId, userId, joinOrder: must(next).n })
    .onConflictDoNothing()
    .returning({ userId: groupMembers.userId });
  if (joined.length) {
    const [who] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    await recordEvent(tx, groupId, userId, { type: 'member_joined', userId, name: who?.name ?? who?.email ?? '' });
  }
  // Если человека звали по почте, приглашение выполнено.
  await tx
    .update(invites)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(invites.groupId, groupId),
        eq(invites.kind, 'email'),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        inArray(invites.email, tx.select({ email: users.email }).from(users).where(eq(users.id, userId))),
      ),
    );
}

async function createLinkInvite(tx: Tx, groupId: string, createdBy: string) {
  const token = randomToken(10);
  await tx.insert(invites).values({ groupId, kind: 'link', token, createdBy, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
  return token;
}

/** Действующая ссылка-приглашение. Истёкшая заменяется новой автоматически. */
async function activeLinkToken(tx: Tx, groupId: string, userId: string): Promise<string> {
  const [link] = await tx
    .select()
    .from(invites)
    .where(and(eq(invites.groupId, groupId), eq(invites.kind, 'link'), isNull(invites.revokedAt)))
    .limit(1);
  if (link && link.expiresAt > new Date()) return link.token;
  if (link) await tx.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, link.id));
  // Два одновременных GET могут оба увидеть истёкшую ссылку. Уникальный индекс пропустит
  // только одну новую; второй запрос молча возьмёт ту, что успел создать первый.
  const token = randomToken(10);
  await tx
    .insert(invites)
    .values({ groupId, kind: 'link', token, createdBy: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .onConflictDoNothing();
  const [active] = await tx
    .select({ token: invites.token })
    .from(invites)
    .where(and(eq(invites.groupId, groupId), eq(invites.kind, 'link'), isNull(invites.revokedAt)))
    .limit(1);
  return must(active).token;
}

/** Приглашения по почте: письмо каждому адресу, кроме тех, кто уже в группе или уже приглашён. */
export async function inviteByEmail(
  tx: Tx,
  group: GroupRow,
  inviter: { id: string; name: string; email: string; gender: 'f' | 'm' | null },
  emails: string[],
) {
  const members = await listMembers(tx, group.id, group.ownerId);
  const memberEmails = new Set(members.map((m) => m.email));
  const unique = [...new Set(emails)].filter((e) => !memberEmails.has(e));

  const [sent] = await tx
    .select({ n: dsql<number>`count(*)`.mapWith(Number) })
    .from(invites)
    .where(and(eq(invites.createdBy, inviter.id), eq(invites.kind, 'email'), gt(invites.createdAt, new Date(Date.now() - 86_400_000))));
  if (must(sent).n + unique.length > EMAIL_INVITES_PER_DAY) {
    throw new HttpError(429, 'too_many_invites', 'Слишком много приглашений за сутки. Позови остальных по ссылке.');
  }

  // Истёкшие приглашения на эти адреса закрываем, иначе уникальный индекс молча не даст пригласить заново.
  if (unique.length) {
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.groupId, group.id),
          eq(invites.kind, 'email'),
          inArray(invites.email, unique),
          isNull(invites.revokedAt),
          isNull(invites.acceptedAt),
          lte(invites.expiresAt, new Date()),
        ),
      );
  }

  for (const email of unique) {
    const token = randomToken(10);
    const [created] = await tx
      .insert(invites)
      .values({ groupId: group.id, kind: 'email', token, email, createdBy: inviter.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .onConflictDoNothing()
      .returning({ id: invites.id });
    if (!created) continue; // этот адрес уже ждёт приглашения
    await enqueueEmail(
      tx,
      `invite:${created.id}`,
      inviteEmail({
        to: email,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
        inviterGender: inviter.gender,
        groupName: group.name,
        currency: group.currency,
        memberNames: members.map((m) => m.name),
        url: inviteUrl(token),
      }),
    );
  }
}

export async function createGroup(
  tx: Tx,
  owner: { id: string; name: string; email: string; gender: 'f' | 'm' | null },
  input: { name: string; currency: string; reminderDays: number; inviteEmails: string[] },
) {
  const [group] = await tx
    .insert(groups)
    .values({ name: input.name, currency: input.currency, reminderDays: input.reminderDays, ownerId: owner.id })
    .returning();
  await tx.insert(groupMembers).values({ groupId: must(group).id, userId: owner.id, joinOrder: 1 });
  await createLinkInvite(tx, must(group).id, owner.id);
  if (input.inviteEmails.length) await inviteByEmail(tx, must(group), owner, input.inviteEmails);
  return must(group);
}

export async function groupDto(tx: Tx, group: GroupRow, userId: string): Promise<GroupDto> {
  const members = await listMembers(tx, group.id, group.ownerId);
  const pending = await tx
    .select({ id: invites.id, email: invites.email, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.groupId, group.id), eq(invites.kind, 'email'), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .orderBy(asc(invites.createdAt));
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    status: group.status,
    closedAt: group.closedAt?.toISOString() ?? null,
    ownerId: group.ownerId,
    reminderDays: group.reminderDays,
    memberNames: members.map((m) => m.name),
    memberCount: members.length,
    myBalance: (await balancesByGroup(tx, [group.id])).get(group.id)?.get(userId) ?? 0,
    members,
    pendingInvites: pending
      .flatMap((p) =>
        p.email && p.createdAt.getTime() + INVITE_TTL_MS > Date.now() ? [{ id: p.id, email: p.email, createdAt: p.createdAt.toISOString() }] : [],
      ),
    inviteToken: await activeLinkToken(tx, group.id, userId),
    currencyLocked: await hasExpenses(tx, group.id),
  };
}

export async function listGroups(tx: Tx, userId: string): Promise<GroupSummaryDto[]> {
  const rows = await tx
    .select({ group: groups })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .orderBy(asc(groups.status), dsql`${groups.createdAt} desc`);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.group.id);
  const names = await tx
    .select({ groupId: groupMembers.groupId, name: users.name, email: users.email })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(inArray(groupMembers.groupId, ids))
    .orderBy(asc(groupMembers.joinOrder));
  const byGroup = new Map<string, string[]>();
  for (const n of names) byGroup.set(n.groupId, [...(byGroup.get(n.groupId) ?? []), n.name ?? n.email]);
  const balances = await balancesByGroup(tx, ids);

  return rows.map(({ group }) => {
    const memberNames = byGroup.get(group.id) ?? [];
    return {
      id: group.id,
      name: group.name,
      currency: group.currency,
      status: group.status,
      closedAt: group.closedAt?.toISOString() ?? null,
      memberNames,
      memberCount: memberNames.length,
      myBalance: balances.get(group.id)?.get(userId) ?? 0,
    };
  });
}

/** Новая ссылка-приглашение; старая перестаёт работать (экран M12). */
export async function rotateLink(tx: Tx, groupId: string, userId: string) {
  await tx
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.groupId, groupId), eq(invites.kind, 'link'), isNull(invites.revokedAt)));
  return createLinkInvite(tx, groupId, userId);
}

async function findInvite(tx: Tx, token: string) {
  const [row] = await tx
    .select({ invite: invites, group: groups, inviterName: users.name, inviterEmail: users.email, inviterGender: users.gender })
    .from(invites)
    .innerJoin(groups, eq(groups.id, invites.groupId))
    .innerJoin(users, eq(users.id, invites.createdBy))
    .where(eq(invites.token, token))
    .limit(1);
  if (!row) throw notFound('Приглашение не найдено');
  return row;
}

function invalidReason(invite: typeof invites.$inferSelect, group: GroupRow): 'rotated' | 'expired' | 'closed' | null {
  if (group.status === 'closed') return 'closed';
  if (invite.revokedAt) return 'rotated';
  // Приглашение по почте одноразовое: после вступления пересланное письмо уже не пустит в группу.
  if (invite.kind === 'email' && invite.acceptedAt) return 'rotated';
  if (invite.expiresAt <= new Date()) return 'expired';
  return null;
}

/** Превью приглашения для страницы M10 (или M12, если ссылка устарела). Доступно без входа. */
export async function previewInvite(tx: Tx, token: string, userId: string | null): Promise<InvitePreviewDto> {
  const { invite, group, inviterName, inviterEmail, inviterGender } = await findInvite(tx, token);
  const inviter = inviterName ?? inviterEmail;
  const reason = invalidReason(invite, group);
  if (reason) return { status: 'expired', groupName: group.name, inviterName: inviter, inviterGender, reason };

  const members = await listMembers(tx, group.id, group.ownerId);
  return {
    status: 'valid',
    groupId: group.id,
    groupName: group.name,
    currency: group.currency,
    inviterName: inviter,
    memberNames: members.map((m) => m.name),
    alreadyMember: !!userId && members.some((m) => m.userId === userId),
  };
}

/** Вступление по приглашению. Повторное вступление безопасно и просто возвращает группу. */
export async function acceptInvite(tx: Tx, token: string, userId: string) {
  const { invite: found } = await findInvite(tx, token);
  const [group] = await tx.select().from(groups).where(eq(groups.id, found.groupId)).for('update');
  // Перечитываем приглашение уже под блокировкой группы: пока мы ждали, ссылку могли заменить.
  const [invite] = await tx.select().from(invites).where(eq(invites.id, found.id));
  const reason = invalidReason(must(invite), must(group));
  if (reason) throw conflict('invite_expired', 'Приглашение больше не работает');
  // addMember сам отметит приглашение по почте принятым, если адрес вступившего совпадает.
  // Чужое приглашение (переслали письмо) работает как ссылка и не «съедает» приглашение адресата.
  await addMember(tx, must(group).id, userId);
  return must(group);
}
