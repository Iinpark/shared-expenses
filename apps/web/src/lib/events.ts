/** Тексты и арифметика событий группы для тостов, формы и ленты. Без запросов к API. */
import { byGender, expenseEffect, type ExpenseSnapshot, type Gender, type GroupDto, type GroupEventDto, type GroupEventPayload } from '@se/shared';
import { CATEGORY_LABELS, money } from './format.js';

export type ExpensePayload = Extract<GroupEventPayload, { type: 'expense_created' | 'expense_updated' | 'expense_deleted' }>;

export const isExpenseEvent = (p: GroupEventPayload): p is ExpensePayload =>
  p.type === 'expense_created' || p.type === 'expense_updated' || p.type === 'expense_deleted';

/** Расход до и после события: у нового нет «до», у удалённого нет «после». */
export function snapshots(p: ExpensePayload): { before: ExpenseSnapshot | null; after: ExpenseSnapshot | null } {
  switch (p.type) {
    case 'expense_created':
      return { before: null, after: p.after };
    case 'expense_updated':
      return { before: p.before, after: p.after };
    case 'expense_deleted':
      return { before: p.before, after: null };
  }
}

/** Текущая версия расхода из события: после правки, а у удалённого — последняя. */
export function latest(p: ExpensePayload): ExpenseSnapshot {
  return p.type === 'expense_deleted' ? p.before : p.after;
}

const VERBS: Record<ExpensePayload['type'], [string, string]> = {
  expense_created: ['добавил', 'добавила'],
  expense_updated: ['изменил', 'изменила'],
  expense_deleted: ['удалил', 'удалила'],
};

/** «добавил» / «изменила» / «удалил(а)» по полу того, кто сделал. */
export const expenseVerb = (type: ExpensePayload['type'], gender: Gender | null | undefined) => byGender(gender, ...VERBS[type]);

export const snapshotTitle = (s: ExpenseSnapshot) => s.title || CATEGORY_LABELS[s.category];

const touches = (s: ExpenseSnapshot | null, userId: string) => !!s && (s.payerId === userId || s.shares.some((x) => x.userId === userId));

/** Касается ли расход человека: он платил или участвует в делении — до правки или после. */
export function involves(p: ExpensePayload, userId: string): boolean {
  const { before, after } = snapshots(p);
  return touches(before, userId) || touches(after, userId);
}

/** На сколько событие сдвинуло балансы: эффект нового расхода минус эффект старого. */
export function balanceDeltas(p: ExpensePayload): Map<string, number> {
  const { before, after } = snapshots(p);
  const delta = new Map<string, number>();
  if (after) for (const [id, v] of expenseEffect(after)) delta.set(id, v);
  if (before) for (const [id, v] of expenseEffect(before)) delta.set(id, (delta.get(id) ?? 0) - v);
  return delta;
}

/** «1 000» для круглой суммы, «1 000,50» для остальных: так короче в тосте. */
export function moneyShort(minor: number, currency: string): string {
  return money(minor, currency).replace(/,0+$/, '');
}

export const memberOf = (g: GroupDto | undefined, userId: string) => g?.members.find((m) => m.userId === userId);

/** Пол автора события, если он есть в участниках группы. */
export const actorGender = (g: GroupDto | undefined, event: GroupEventDto) => memberOf(g, event.actorId)?.gender ?? null;

/** «14:32» по часам пользователя. */
export const clock = (ms: number | string) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
