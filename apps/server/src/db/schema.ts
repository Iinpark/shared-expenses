import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const genderEnum = pgEnum('gender', ['f', 'm']);
export const groupStatusEnum = pgEnum('group_status', ['open', 'closed']);
export const inviteKindEnum = pgEnum('invite_kind', ['link', 'email']);

// ---------- Пользователи и вход ----------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Всегда в нижнем регистре. */
  email: text('email').notNull().unique(),
  /** null, пока человек не представился после первого входа. */
  name: text('name'),
  gender: genderEnum('gender'),
  createdAt: createdAt(),
});

/** Одноразовые коды входа. Храним хеш, не сам код. */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_email_idx').on(t.email, t.createdAt)],
);

/** Сессии. В cookie лежит случайный токен, в базе — его хеш. */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------- Группы ----------

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    reminderDays: integer('reminder_days').notNull().default(7),
    status: groupStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check('groups_reminder_days_check', sql`${t.reminderDays} between 1 and 90`)],
);

/**
 * Участники. join_order — порядок вступления: по нему раздаются лишние копейки
 * при делении (правило из handoff дизайна), поэтому он уникален внутри группы.
 */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    joinOrder: integer('join_order').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    unique('group_members_order_unique').on(t.groupId, t.joinOrder),
    index('group_members_user_idx').on(t.userId),
  ],
);

/**
 * Приглашения. У группы одна действующая ссылка (kind = link, email = null);
 * при обновлении старая получает revoked_at. Приглашения по почте — по одному на адрес.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    kind: inviteKindEnum('kind').notNull(),
    token: text('token').notNull().unique(),
    email: text('email'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invites_active_link_unique')
      .on(t.groupId)
      .where(sql`${t.kind} = 'link' and ${t.revokedAt} is null`),
    uniqueIndex('invites_active_email_unique')
      .on(t.groupId, t.email)
      .where(sql`${t.kind} = 'email' and ${t.revokedAt} is null and ${t.acceptedAt} is null`),
  ],
);

// ---------- Почта ----------

/**
 * Очередь писем (transactional outbox). Письмо пишется в той же транзакции, что и событие,
 * а фоновый воркер отправляет его. dedupe_key уникален: одно событие — ровно одно письмо.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_outbox_pending_idx').on(t.nextAttemptAt).where(sql`${t.sentAt} is null`)],
);
