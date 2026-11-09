import type { CreateSettlementInput, SettlementDto } from '@se/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { invalidateGroup, qk } from './keys.js';

const fetchSettlements = (groupId: string) => api<SettlementDto[]>('GET', `/api/groups/${groupId}/settlements`);

/** Погашения группы (M07, M08, S01): сначала ожидающие, потом от новых к старым. */
export const useSettlements = (groupId: string) => useQuery({ queryKey: qk.settlements(groupId), queryFn: () => fetchSettlements(groupId), retry: false });

/**
 * Что ждёт подтверждения текущего пользователя в каждой из групп (M01: «2 000,00 ждут тебя», напоминание
 * через три дня). Запрос на группу, и только для тех, где тебе вообще должны вернуть. Группы без таких отметок в карту не попадают.
 */
export function usePendingToMe(groupIds: string[], meId: string): Map<string, SettlementDto[]> {
  return useQueries({
    queries: groupIds.map((id) => ({ queryKey: qk.settlements(id), queryFn: () => fetchSettlements(id), retry: false })),
    combine: (results) => {
      const byGroup = new Map<string, SettlementDto[]>();
      results.forEach((r, i) => {
        const id = groupIds[i];
        if (!id || !r.data) return;
        const mine = r.data.filter((s) => s.status === 'pending' && s.toId === meId);
        if (mine.length > 0) byGroup.set(id, mine);
      });
      return byGroup;
    },
  });
}

/**
 * Свои действия: перезапросить всё по группе, в том числе то, что сейчас не на экране,
 * чтобы экран группы не подсветил собственное изменение как чужое.
 */
function useSettlementMutation<V>(groupId: string, request: (v: V) => Promise<SettlementDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => invalidateGroup(qc, groupId, 'all'),
  });
}

/** Должник отмечает, что передал деньги (M07). */
export const useMarkSettlement = (groupId: string) =>
  useSettlementMutation(groupId, (input: CreateSettlementInput) => api<SettlementDto>('POST', `/api/groups/${groupId}/settlements`, input));

export type SettlementDecision = 'confirm' | 'reject' | 'cancel';

/** Получатель подтверждает или отклоняет, отметивший — отменяет (M08, PendingCard). */
export const useDecideSettlement = (groupId: string) =>
  useSettlementMutation(groupId, (v: { id: string; action: SettlementDecision }) => api<SettlementDto>('POST', `/api/settlements/${v.id}/${v.action}`));
