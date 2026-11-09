import type { GroupDto, GroupReportDto } from '@se/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { invalidateGroup, qk } from './keys.js';

/** D05: итоговый отчёт группы. Открыт любому участнику, и в открытой, и в закрытой группе (ссылка из письма E03). */
export const useGroupReport = (groupId: string) =>
  useQuery({ queryKey: qk.report(groupId), queryFn: () => api<GroupReportDto>('GET', `/api/groups/${groupId}/report`), retry: false });

/**
 * Закрыть или открыть снова (только создатель). Сервер отвечает группой: кладём её в кэш сразу,
 * остальное по группе перезапрашиваем целиком — после закрытия меняются кнопки на всех экранах.
 */
function useStatusMutation(groupId: string, action: 'close' | 'reopen') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<GroupDto>('POST', `/api/groups/${groupId}/${action}`),
    onSuccess: async (group) => {
      qc.setQueryData(qk.group(group.id), group);
      await invalidateGroup(qc, groupId, 'all');
    },
  });
}

export const useCloseGroup = (groupId: string) => useStatusMutation(groupId, 'close');
export const useReopenGroup = (groupId: string) => useStatusMutation(groupId, 'reopen');
