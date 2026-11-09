import type { GroupDto } from '@se/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export const useGroup = (id: string) =>
  useQuery({ queryKey: ['group', id], queryFn: () => api<GroupDto>('GET', `/api/groups/${id}`), retry: false });

export const inviteLink = (token: string) => `${location.origin}/j/${token}`;
