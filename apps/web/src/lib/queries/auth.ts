import { must, type Gender, type Me } from '@se/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.js';
import { qk } from './keys.js';

/** Текущий пользователь; null — не вошёл. */
export function useMe() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: async () => {
      try {
        return await api<Me>('GET', '/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });
}

/** Текущий пользователь на страницах внутри RequireUser: там он всегда есть. */
export function useCurrentUser(): Me {
  return must(useMe().data, 'вошедший пользователь');
}

export const useRequestCode = () => useMutation({ mutationFn: (email: string) => api('POST', '/api/auth/request-code', { email }) });

export function useVerifyCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; code: string }) => api<Me>('POST', '/api/auth/verify', v),
    onSuccess: (me) => {
      qc.setQueryData(qk.me(), me);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; gender: Gender | null }) => api<Me>('PATCH', '/api/me', v),
    onSuccess: (me) => {
      qc.setQueryData(qk.me(), me);
    },
  });
}

/** Выход: кэш чистим целиком, чтобы следующий вошедший не увидел чужих групп. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('POST', '/api/auth/logout'),
    onSuccess: () => {
      qc.clear();
    },
  });
}
