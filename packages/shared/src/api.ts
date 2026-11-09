import { z } from 'zod';
import type { Balance, Transfer } from './balances.js';
import { CURRENCIES } from './currency.js';
import { MAX_AMOUNT } from './money.js';
import type { SplitMode } from './split.js';

/** Контракты API: схемы запросов и типы ответов, общие для сервера и клиента. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Похоже, в адресе опечатка' }));

// ---------- Вход ----------

export const requestCodeSchema = z.object({ email: emailSchema });

export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Код состоит из 6 цифр'),
});

export const genderSchema = z.enum(['f', 'm']);
export type Gender = z.infer<typeof genderSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Как тебя зовут?').max(40),
  gender: genderSchema.nullable(),
});

export interface Me {
  id: string;
  email: string;
  /** null — человек ещё не представился после первого входа. */
  name: string | null;
  gender: Gender | null;
}

// ---------- Группы ----------

export const groupNameSchema = z.string().trim().min(1, 'Назови группу').max(60);
export const reminderDaysSchema = z.number({ message: 'От 1 до 90 дней' }).int('От 1 до 90 дней').min(1, 'От 1 до 90 дней').max(90, 'От 1 до 90 дней');

export const createGroupSchema = z.object({
  name: groupNameSchema,
  currency: z.enum(CURRENCIES),
  reminderDays: reminderDaysSchema,
  inviteEmails: z.array(emailSchema).max(30).default([]),
});

export const updateGroupSchema = z
  .object({
    name: groupNameSchema,
    currency: z.enum(CURRENCIES),
    reminderDays: reminderDaysSchema,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'Нечего сохранять');

export const inviteEmailsSchema = z.object({ emails: z.array(emailSchema).min(1).max(30) });

export type GroupStatus = 'open' | 'closed';

export interface MemberDto {
  userId: string;
  name: string;
  gender: Gender | null;
  email: string;
  joinOrder: number;
  isOwner: boolean;
}

export interface PendingInviteDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface GroupSummaryDto {
  id: string;
  name: string;
  currency: string;
  status: GroupStatus;
  closedAt: string | null;
  memberNames: string[];
  memberCount: number;
  /** Баланс текущего пользователя в этой группе. */
  myBalance: number;
}

export interface GroupDto extends GroupSummaryDto {
  ownerId: string;
  reminderDays: number;
  members: MemberDto[];
  pendingInvites: PendingInviteDto[];
  /** Токен действующей ссылки-приглашения. */
  inviteToken: string;
  /** Валюту можно менять, пока в группе нет расходов. */
  currencyLocked: boolean;
}

export type InvitePreviewDto =
  | {
      status: 'valid';
      groupId: string;
      groupName: string;
      currency: string;
      inviterName: string;
      memberNames: string[];
      /** Текущий пользователь уже в группе. */
      alreadyMember: boolean;
    }
  | {
      status: 'expired';
      groupName: string;
      inviterName: string;
      inviterGender: Gender | null;
      reason: 'rotated' | 'expired' | 'closed';
    };

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------- Расходы ----------

export const EXPENSE_CATEGORIES = ['food', 'transport', 'housing', 'fun', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const userId = z.uuid({ message: 'Неизвестный участник' });
const minor = z.number().int().nonnegative();

export const splitSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equal'), userIds: z.array(userId).min(1, 'Выбери, на кого делить').max(100) }),
  z.object({
    mode: z.literal('shares'),
    shares: z.array(z.object({ userId, weight: z.number().int().min(0).max(1000) })).min(1).max(100),
  }),
  z.object({
    mode: z.literal('exact'),
    shares: z.array(z.object({ userId, amount: minor.max(MAX_AMOUNT) })).min(1).max(100),
  }),
]);

export const expenseInputSchema = z.object({
  amount: z
    .number()
    .int()
    .positive('Сумма должна быть больше нуля')
    .max(MAX_AMOUNT, 'Слишком большая сумма'),
  title: z.string().trim().max(80, 'Слишком длинное название').default(''),
  category: z.enum(EXPENSE_CATEGORIES),
  payerId: userId,
  spentOn: z.iso.date({ message: 'Неверная дата' }),
  comment: z.string().trim().max(500, 'Слишком длинный комментарий').nullable().default(null),
  split: splitSchema,
});
export type ExpenseInput = z.input<typeof expenseInputSchema>;

/** Правка расхода: те же поля плюс версия, с которой человек начал править. */
export const expenseUpdateSchema = expenseInputSchema.extend({ version: z.number().int().positive() });
export type ExpenseUpdate = z.input<typeof expenseUpdateSchema>;

export interface ExpenseShareDto {
  userId: string;
  amount: number;
  weight: number | null;
}

export interface ExpenseDto {
  id: string;
  groupId: string;
  amount: number;
  title: string;
  category: ExpenseCategory;
  payerId: string;
  spentOn: string;
  comment: string | null;
  splitMode: SplitMode;
  shares: ExpenseShareDto[];
  /** Растёт на 1 при каждой правке. Правка со старой версией получает 409. */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface BalancesDto {
  /** В порядке вступления. Плюс — участнику вернут, минус — с него. */
  balances: Balance[];
  transfers: Transfer[];
  /** Сколько всего потрачено в группе. */
  totalSpent: number;
  expenseCount: number;
}

/** Тело ответа 409 при правке устаревшей версии: что сейчас лежит в базе (для экрана конфликта). */
export interface ExpenseConflictBody extends ApiErrorBody {
  current: ExpenseDto | null;
}

// ---------- События группы: лента и реалтайм ----------

/** Расход в событии: столько, чтобы показать «что было → что стало» и кого задело. */
export interface ExpenseSnapshot {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  payerId: string;
  spentOn: string;
  shares: { userId: string; amount: number }[];
}

export type GroupEventPayload =
  | { type: 'expense_created'; after: ExpenseSnapshot }
  | { type: 'expense_updated'; before: ExpenseSnapshot; after: ExpenseSnapshot }
  | { type: 'expense_deleted'; before: ExpenseSnapshot }
  | { type: 'member_joined'; userId: string; name: string }
  | { type: 'group_updated'; changes: { field: 'name' | 'currency' | 'reminderDays'; from: string | number; to: string | number }[] }
  | { type: 'settlement_created' | 'settlement_confirmed' | 'settlement_rejected' | 'settlement_cancelled'; settlement: SettlementSnapshot };

/** Погашение в событии ленты. */
export interface SettlementSnapshot {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  comment: string | null;
}

export type GroupEventType = GroupEventPayload['type'];

export interface GroupEventDto {
  id: string;
  groupId: string;
  actorId: string;
  /** Имя на момент запроса: участник мог переименоваться. */
  actorName: string;
  createdAt: string;
  payload: GroupEventPayload;
}

/** Страница ленты: события от новых к старым, nextBefore — id события-курсора для следующей страницы. */
export interface GroupEventsPage {
  events: GroupEventDto[];
  nextBefore: string | null;
}

/**
 * Поток GET /api/events/stream (Server-Sent Events). Типы событий в потоке:
 * group_event — данные GroupEventDto; resync — пропущено слишком много, перезагрузить всё;
 * ready — досылка после переподключения закончена.
 */
export const SSE_EVENTS = { groupEvent: 'group_event', resync: 'resync', ready: 'ready' } as const;

// ---------- Погашения ----------

export const createSettlementSchema = z.object({
  toId: z.uuid({ message: 'Неизвестный участник' }),
  amount: z.number().int().positive('Сумма должна быть больше нуля').max(MAX_AMOUNT, 'Слишком большая сумма'),
  comment: z.string().trim().max(300, 'Слишком длинный комментарий').nullable().default(null),
});
export type CreateSettlementInput = z.input<typeof createSettlementSchema>;

export type SettlementStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface SettlementDto {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  amount: number;
  comment: string | null;
  /** pending — отмечено должником, ждёт получателя; в баланс идёт только confirmed. */
  status: SettlementStatus;
  createdAt: string;
  decidedAt: string | null;
}
