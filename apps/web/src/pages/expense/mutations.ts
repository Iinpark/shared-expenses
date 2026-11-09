import type { ExpenseConflictBody, ExpenseDto, ExpenseInput, GroupDto } from '@se/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components/Toast.js';
import { api, ApiError, errorText } from '../../lib/api.js';
import { invalidateGroup } from '../../lib/expenses.js';

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

/**
 * Сохранение и удаление расхода. Версия по умолчанию — та, с которой человек начал править
 * (baseVersion), а не то, что потом пришло с сервера: иначе чужая правка затрётся без 409.
 */
export function useExpenseMutations(g: GroupDto, expense: ExpenseDto | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [baseVersion] = useState(expense?.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  async function run(action: ConflictAction, request: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await request();
      await invalidateGroup(qc, g.id);
      qc.removeQueries({ queryKey: ['expense', expense?.id] });
      toast(done);
      await navigate(`/groups/${g.id}`);
    } catch (err) {
      const c = toConflict(err, action, !!expense);
      if (c) {
        setConflict(c);
        void invalidateGroup(qc, g.id); // превью балансов должно считаться от свежих цифр
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    conflict,
    save(input: ExpenseInput, version = baseVersion) {
      const request = expense
        ? () => api<ExpenseDto>('PUT', `/api/expenses/${expense.id}`, { ...input, version })
        : () => api<ExpenseDto>('POST', `/api/groups/${g.id}/expenses`, input);
      return run('save', request, expense ? 'Изменения сохранены' : 'Расход добавлен');
    },
    remove(version = baseVersion) {
      if (!expense) return Promise.resolve();
      return run('delete', () => api('DELETE', `/api/expenses/${expense.id}?version=${String(version)}`), 'Расход удалён');
    },
  };
}

export type Mutations = ReturnType<typeof useExpenseMutations>;
