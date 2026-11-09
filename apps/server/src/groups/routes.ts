import { must } from '@se/shared';
import { createGroupSchema, inviteEmailsSchema, updateGroupSchema } from '@se/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { db } from '../db/client.js';
import { groups } from '../db/schema.js';
import { conflict, parse } from '../lib/errors.js';
import {
  acceptInvite,
  assertOpen,
  assertOwner,
  createGroup,
  getMemberGroup,
  groupDto,
  inviteByEmail,
  listGroups,
  previewInvite,
  rotateLink,
} from './service.js';
import { listEvents, recordEvent } from '../events/service.js';
import { hasExpenses } from '../expenses/service.js';

/** Что именно поменялось в настройках: для ленты «Аня переименовала группу». */
function groupChanges(
  group: { name: string; currency: string; reminderDays: number },
  patch: { name?: string; currency?: string; reminderDays?: number },
) {
  const fields = ['name', 'currency', 'reminderDays'] as const;
  return fields.flatMap((field) => {
    const to = patch[field];
    return to !== undefined && to !== group[field] ? [{ field, from: group[field], to }] : [];
  });
}

const idParams = z.object({ id: z.uuid({ message: 'Группа не найдена' }) });
const eventsQuery = z.object({ before: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const tokenParams = z.object({ token: z.string().min(1).max(64) });

export function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups', async (req) => {
    const user = requireProfile(req);
    return listGroups(db, user.id);
  });

  app.post('/api/groups', async (req, reply) => {
    const user = requireProfile(req);
    const input = parse(createGroupSchema, req.body);
    const dto = await db.transaction(async (tx) => {
      const group = await createGroup(tx, user, input);
      return groupDto(tx, group, user.id);
    });
    return reply.status(201).send(dto);
  });

  app.get('/api/groups/:id', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    return db.transaction(async (tx) => groupDto(tx, await getMemberGroup(tx, id, user.id), user.id));
  });

  app.patch('/api/groups/:id', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    const patch = parse(updateGroupSchema, req.body);
    return db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOwner(group, user.id);
      assertOpen(group);
      if (patch.currency && patch.currency !== group.currency && (await hasExpenses(tx, id))) {
        throw conflict('currency_locked', 'В группе уже есть расходы, валюту не поменять');
      }
      const [updated] = await tx.update(groups).set(patch).where(eq(groups.id, id)).returning();
      const changes = groupChanges(group, patch);
      if (changes.length) await recordEvent(tx, id, user.id, { type: 'group_updated', changes });
      return groupDto(tx, must(updated), user.id);
    });
  });

  /** Лента группы (M03): от новых к старым, по 50 событий, дальше — с курсором before. */
  app.get('/api/groups/:id/events', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    const { before, limit } = parse(eventsQuery, req.query);
    return db.transaction(async (tx) => {
      await getMemberGroup(tx, id, user.id);
      return listEvents(tx, id, before ?? null, limit);
    });
  });

  app.post('/api/groups/:id/invites', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    const { emails } = parse(inviteEmailsSchema, req.body);
    return db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOpen(group);
      await inviteByEmail(tx, group, user, emails);
      return groupDto(tx, group, user.id);
    });
  });

  app.post('/api/groups/:id/invite-link/rotate', async (req) => {
    const user = requireProfile(req);
    const { id } = parse(idParams, req.params);
    return db.transaction(async (tx) => {
      const group = await getMemberGroup(tx, id, user.id, { lock: true });
      assertOwner(group, user.id);
      await rotateLink(tx, id, user.id);
      return groupDto(tx, group, user.id);
    });
  });

  // ---------- Приглашения ----------

  /** Превью доступно без входа: человек должен понять, куда его зовут, до того как вводить почту. */
  app.get('/api/invites/:token', async (req) => {
    const { token } = parse(tokenParams, req.params);
    return previewInvite(db, token, req.user?.id ?? null);
  });

  app.post('/api/invites/:token/accept', async (req) => {
    const user = requireProfile(req);
    const { token } = parse(tokenParams, req.params);
    const group = await db.transaction((tx) => acceptInvite(tx, token, user.id));
    return { groupId: group.id };
  });
  return Promise.resolve();
}
