import { z } from 'zod';
import { CURRENCIES } from './currency.js';

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
export const reminderDaysSchema = z.number().int().min(1).max(90);

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
  .partial();

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
