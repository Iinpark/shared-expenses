import { must, type Me } from '@se/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api.js';

/** Текущий пользователь; null — не вошёл. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
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

export function useSetMe() {
  const qc = useQueryClient();
  return (me: Me | null) => {
    qc.setQueryData(['me'], me);
  };
}

/** Текущий пользователь на страницах внутри RequireUser: там он всегда есть. */
export function useCurrentUser(): Me {
  return must(useMe().data, 'вошедший пользователь');
}
