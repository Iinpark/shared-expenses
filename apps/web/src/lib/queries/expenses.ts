import type { BalancesDto, ExpenseConflictBody, ExpenseDto, ExpenseInput } from '@se/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, errorText } from '../api.js';
import { invalidateGroup, qk } from './keys.js';

export const useExpenses = (groupId: string) =>
  useQuery({ queryKey: qk.expenses(groupId), queryFn: () => api<ExpenseDto[]>('GET', `/api/groups/${groupId}/expenses`), retry: false });

export const useBalances = (groupId: string) =>
  useQuery({ queryKey: qk.balances(groupId), queryFn: () => api<BalancesDto>('GET', `/api/groups/${groupId}/balances`), retry: false });

/** Расход для формы правки; без id (новый расход) запрос не идёт. */
export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: qk.expense(id),
    queryFn: () => api<ExpenseDto>('GET', `/api/expenses/${id ?? ''}`),
    enabled: !!id,
    retry: false,
    // Пока форма открыта, расход не перезапрашиваем: иначе версия тихо обновится под старыми полями
    // и правка затрёт чужую без 409. Свежие данные — при следующем открытии формы.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export type ConflictAction = 'save' | 'delete';
export interface Conflict {
  current: ExpenseDto | null;
  action: ConflictAction;
}

/** Ошибка API, которая значит «расход изменили или удалили, пока была открыта форма». */
function toConflict(err: unknown, action: ConflictAction, editing: boolean): Conflict | null {
  if (!(err instanceof ApiError)) return null;
  const isVersion = err.status === 409 && (err.code === 'version_conflict' || err.code === 'expense_deleted');
  if (!isVersion && !(editing && err.status === 404)) return null;
  return { current: (err.body as ExpenseConflictBody | undefined)?.current ?? null, action };
}

/** После любого изменения: всё по группе, а сам расход выкидываем — следующая форма возьмёт свежий. */
function useExpenseMutation<V>(groupId: string, expenseId: string | undefined, request: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await invalidateGroup(qc, groupId);
      qc.removeQueries({ queryKey: qk.expense(expenseId) });
    },
  });
}

const useCreateExpense = (groupId: string) =>
  useExpenseMutation(groupId, undefined, (input: ExpenseInput) => api<ExpenseDto>('POST', `/api/groups/${groupId}/expenses`, input));

const useUpdateExpense = (groupId: string, expenseId: string | undefined) =>
  useExpenseMutation(groupId, expenseId, (v: { id: string; input: ExpenseInput; version: number | undefined }) =>
    api<ExpenseDto>('PUT', `/api/expenses/${v.id}`, { ...v.input, version: v.version }),
  );

const useDeleteExpense = (groupId: string, expenseId: string | undefined) =>
  useExpenseMutation(groupId, expenseId, (v: { id: string; version: number | undefined }) =>
    api('DELETE', `/api/expenses/${v.id}?version=${String(v.version)}`),
  );

/**
 * Сохранение и удаление расхода с оптимистичной блокировкой. Версия по умолчанию — та, с которой
 * человек начал править (baseVersion), а не то, что потом пришло с сервера: иначе чужая правка затрётся без 409.
 * save/remove отвечают true, если всё прошло; тост и переход — на стороне страницы.
 */
export function useExpenseEditor(groupId: string, expense: ExpenseDto | undefined) {
  const qc = useQueryClient();
  const [baseVersion] = useState(expense?.version);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const create = useCreateExpense(groupId);
  const update = useUpdateExpense(groupId, expense?.id);
  const remove = useDeleteExpense(groupId, expense?.id);

  async function run(action: ConflictAction, request: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await request();
      return true;
    } catch (err) {
      const c = toConflict(err, action, !!expense);
      if (c) {
        setConflict(c);
        void invalidateGroup(qc, groupId); // превью балансов должно считаться от свежих цифр
      } else {
        setError(errorText(err));
      }
      return false;
    }
  }

  return {
    busy: create.isPending || update.isPending || remove.isPending,
    error,
    conflict,
    save(input: ExpenseInput, version = baseVersion) {
      const request = expense ? () => update.mutateAsync({ id: expense.id, input, version }) : () => create.mutateAsync(input);
      return run('save', request);
    },
    remove(version = baseVersion) {
      if (!expense) return Promise.resolve(false);
      return run('delete', () => remove.mutateAsync({ id: expense.id, version }));
    },
  };
}
