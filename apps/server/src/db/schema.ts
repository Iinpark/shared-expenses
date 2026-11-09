import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  date,
  check,
  index,
  integer,
  jsonb,
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
export const expenseCategoryEnum = pgEnum('expense_category', ['food', 'transport', 'housing', 'fun', 'other']);
export const groupEventTypeEnum = pgEnum('group_event_type', [
  'expense_created',
  'expense_updated',
  'expense_deleted',
  'member_joined',
  'group_updated',
  'settlement_created',
  'settlement_confirmed',
  'settlement_rejected',
  'settlement_cancelled',
  'group_closed',
  'group_reopened',
]);
export const settlementStatusEnum = pgEnum('settlement_status', ['pending', 'confirmed', 'rejected', 'cancelled']);
export const splitModeEnum = pgEnum('split_mode', ['equal', 'shares', 'exact']);

/** Деньги: целые минимальные единицы валюты. bigint в базе, number в коде (до 2^53 точно). */
const money = (name: string) => bigint(name, { mode: 'number' });

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
    /** С какого момента баланс участника в минусе (null — не в минусе). Ведёт фоновая проверка напоминаний. */
    debtSince: timestamp('debt_since', { withTimezone: true }),
    /** Когда последний раз отправили напоминание: не чаще раза в неделю. */
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
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

// ---------- Расходы ----------

/**
 * Расход. Удаление мягкое (deleted_at): история нужна ленте группы.
 * version растёт при каждой правке; правка со старой версией отклоняется (409).
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    payerId: uuid('payer_id')
      .notNull()
      .references(() => users.id),
    amount: money('amount').notNull(),
    title: text('title').notNull().default(''),
    category: expenseCategoryEnum('category').notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    comment: text('comment'),
    splitMode: splitModeEnum('split_mode').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Файл чека: имя файла в папке загрузок (случайное), исходное имя, тип и размер. */
    receiptFile: text('receipt_file'),
    receiptName: text('receipt_name'),
    receiptType: text('receipt_type'),
    receiptSize: integer('receipt_size'),
  },
  (t) => [
    check('expenses_amount_positive', sql`${t.amount} > 0`),
    index('expenses_group_idx').on(t.groupId, t.spentOn).where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Доли расхода, уже посчитанные (с лишними копейками). weight — число долей в режимах
 * «поровну» (1) и «долями»; в режиме «суммами» null. Сумма долей = сумме расхода
 * (проверяется в коде перед записью, тем же кодом, что и превью в форме).
 */
export const expenseShares = pgTable(
  'expense_shares',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amount: money('amount').notNull(),
    weight: integer('weight'),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.userId] }),
    index('expense_shares_user_idx').on(t.userId),
    check('expense_shares_amount_nonneg', sql`${t.amount} >= 0`),
  ],
);

// ---------- Погашения ----------

/**
 * Погашение: должник отметил, что передал деньги получателю. В баланс идёт только после подтверждения
 * получателем (status = confirmed). Отклонённые и отменённые остаются для ленты и истории.
 */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    fromId: uuid('from_id')
      .notNull()
      .references(() => users.id),
    toId: uuid('to_id')
      .notNull()
      .references(() => users.id),
    amount: money('amount').notNull(),
    comment: text('comment'),
    status: settlementStatusEnum('status').notNull().default('pending'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    check('settlements_amount_positive', sql`${t.amount} > 0`),
    check('settlements_not_self', sql`${t.fromId} <> ${t.toId}`),
    index('settlements_group_idx').on(t.groupId, t.status),
  ],
);

// ---------- События группы (лента и реалтайм) ----------

/**
 * Что произошло в группе. Пишется в той же транзакции, что и само изменение, поэтому лента
 * никогда не расходится с данными. payload — снимки «до» и «после» (тип GroupEventPayload в @se/shared).
 * После коммита Postgres рассылает NOTIFY, и сервер отправляет событие участникам в поток SSE.
 */
export const groupEvents = pgTable(
  'group_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    type: groupEventTypeEnum('type').notNull(),
    payload: jsonb('payload').notNull(),
    // clock_timestamp(), а не now(): now() — время начала транзакции, и транзакция, долго ждавшая
    // блокировку, получила бы время раньше уже закоммиченных событий. Курсор досылки съехал бы.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [index('group_events_group_idx').on(t.groupId, t.createdAt)],
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
