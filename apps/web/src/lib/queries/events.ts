import type { GroupEventsPage } from '@se/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { qk } from './keys.js';

const PAGE = 50;

/**
 * Лента группы (M03) страницами от новых к старым. Новые события сверху появляются сами:
 * слой реалтайма инвалидирует qk.events(groupId) через invalidateGroup.
 */
export function useGroupFeed(groupId: string) {
  return useInfiniteQuery({
    queryKey: qk.events(groupId),
    queryFn: ({ pageParam }) =>
      api<GroupEventsPage>('GET', `/api/groups/${groupId}/events?limit=${String(PAGE)}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    retry: false,
  });
}
