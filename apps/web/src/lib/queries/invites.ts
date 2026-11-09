import type { InvitePreviewDto } from '@se/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useMe } from './auth.js';
import { qk } from './keys.js';

/** Превью приглашения; после входа перезапрашивается, потому что ключ включает пользователя. */
export function useInvitePreview(token: string) {
  const userId = useMe().data?.id ?? null;
  return useQuery({ queryKey: qk.invite(token, userId), queryFn: () => api<InvitePreviewDto>('GET', `/api/invites/${token}`), retry: false });
}

export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ groupId: string }>('POST', `/api/invites/${token}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups() }),
  });
}
