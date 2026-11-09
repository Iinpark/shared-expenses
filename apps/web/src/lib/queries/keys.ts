import type { QueryClient } from '@tanstack/react-query';

/**
 * Единственное место, где живут ключи кэша. Страницы и слой реалтайма (realtime.tsx) берут их отсюда,
 * чтобы инвалидация по событию сервера попадала ровно в те же запросы.
 */
export const qk = {
  me: () => ['me'] as const,
  groups: () => ['groups'] as const,
  group: (id: string) => ['group', id] as const,
  expenses: (groupId: string) => ['expenses', groupId] as const,
  balances: (groupId: string) => ['balances', groupId] as const,
  expense: (id: string | undefined) => ['expense', id] as const,
  events: (groupId: string) => ['events', groupId] as const,
  // Превью зависит от того, кто смотрит (alreadyMember), поэтому в ключе есть пользователь.
  invite: (token: string, userId: string | null) => ['invite', token, userId] as const,
};

/** Всё, что зависит от группы: сама группа, список групп, её расходы, балансы и лента. */
export function invalidateGroup(qc: QueryClient, groupId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.expenses(groupId) }),
    qc.invalidateQueries({ queryKey: qk.balances(groupId) }),
    qc.invalidateQueries({ queryKey: qk.group(groupId) }),
    qc.invalidateQueries({ queryKey: qk.groups() }),
    qc.invalidateQueries({ queryKey: qk.events(groupId) }),
  ]);
}
