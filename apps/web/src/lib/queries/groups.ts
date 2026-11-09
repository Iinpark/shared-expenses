import type { CurrencyCode, GroupDto, GroupSummaryDto } from '@se/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { qk } from './keys.js';

export const useGroups = () => useQuery({ queryKey: qk.groups(), queryFn: () => api<GroupSummaryDto[]>('GET', '/api/groups') });

export const useGroup = (id: string) => useQuery({ queryKey: qk.group(id), queryFn: () => api<GroupDto>('GET', `/api/groups/${id}`), retry: false });

/** Сервер отвечает обновлённой группой: кладём её в кэш сразу, а список групп перезапрашиваем. */
function useGroupMutation<V>(request: (v: V) => Promise<GroupDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async (group) => {
      qc.setQueryData(qk.group(group.id), group);
      await qc.invalidateQueries({ queryKey: qk.groups() });
    },
  });
}

export const useCreateGroup = () =>
  useGroupMutation((v: { name: string; currency: CurrencyCode; reminderDays: number; inviteEmails: string[] }) => api<GroupDto>('POST', '/api/groups', v));

export const useUpdateGroup = (groupId: string) =>
  useGroupMutation((v: { name: string; currency: CurrencyCode; reminderDays: number }) => api<GroupDto>('PATCH', `/api/groups/${groupId}`, v));

export const useInviteByEmail = (groupId: string) =>
  useGroupMutation((emails: string[]) => api<GroupDto>('POST', `/api/groups/${groupId}/invites`, { emails }));

export const useRotateInviteLink = (groupId: string) => useGroupMutation(() => api<GroupDto>('POST', `/api/groups/${groupId}/invite-link/rotate`));
