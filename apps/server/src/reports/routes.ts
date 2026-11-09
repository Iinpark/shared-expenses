import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { config } from '../config.js';
import { db, type Tx } from '../db/client.js';
import { groups, users } from '../db/schema.js';
import { assertOwner, getMemberGroup, groupDto } from '../groups/service.js';
import { conflict, parse } from '../lib/errors.js';
import { enqueueEmail } from '../mail/outbox.js';
import { closedEmail } from '../mail/templates.js';
import { groupReport } from './service.js';

const idParams = z.object({ id: z.uuid({ message: 'Группа не найдена' }) });

const reportUrl = (groupId: string) => `${config.webOrigin}/groups/${groupId}/report`;

/** Письмо-итог каждому участнику. Ключ включает момент закрытия: повторное закрытие после правок — новое письмо. */
async function sendClosedEmails(tx: Tx, group: typeof groups.$inferSelect, closedBy: { name: string; gender: 'f' | 'm' | null }) {
  const report = await groupReport(tx, group);
  const ids = report.members.map((m) => m.userId);
  const people = ids.length ? await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids)) : [];
  const emails = new Map(people.map((p) => [p.id, p.email]));
  for (const m of report.members) {
    const to = emails.get(m.userId);
    if (!to) continue;
    await enqueueEmail(
      tx,
      `closed:${group.id}:${String(group.closedAt?.getTime() ?? 0)}:${m.userId}`,
      closedEmail({ to, closedByName: closedBy.name, closedByGender: closedBy.gender, report, url: reportUrl(group.id) }),
    );
  }
}

/** Итоговый отчёт (D05), закрытие и повторное открытие группы. Закрывает и открывает только создатель. */
export function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups/:id/report', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    return db.transaction(async (tx) => groupReport(tx, await getMemberGroup(tx, id, user.id)));
  });

  app.post('/api/groups/:id/close', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    return db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOwner(group, user.id);
      if (group.status === 'closed') throw conflict('group_closed', 'Группа уже закрыта');
      const [closed] = await tx.update(groups).set({ status: 'closed', closedAt: new Date() }).where(eq(groups.id, id)).returning();
      if (!closed) throw new Error('Группа не закрылась');
      await sendClosedEmails(tx, closed, user);
      return groupDto(tx, closed, user.id);
    });
  });

  app.post('/api/groups/:id/reopen', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    return db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOwner(group, user.id);
      if (group.status === 'open') throw conflict('group_open', 'Группа уже открыта');
      const [opened] = await tx.update(groups).set({ status: 'open', closedAt: null }).where(eq(groups.id, id)).returning();
      if (!opened) throw new Error('Группа не открылась');
      return groupDto(tx, opened, user.id);
    });
  });
  return Promise.resolve();
}
