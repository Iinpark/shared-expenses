import type { ExpenseDto } from '@se/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { invalidateGroup, qk } from './keys.js';

/** Сам файл чека: открывается в новой вкладке, отдаётся только участникам группы. */
export const receiptUrl = (expenseId: string) => `/api/expenses/${expenseId}/receipt`;

function uploadReceipt(v: { expenseId: string; file: File }) {
  const form = new FormData();
  form.append('file', v.file);
  return api<ExpenseDto>('PUT', receiptUrl(v.expenseId), form);
}

/** Приложить, заменить или убрать чек. После — всё по группе и сам расход: в списке появится или пропадёт отметка «чек». */
export function useReceiptMutations(groupId: string) {
  const qc = useQueryClient();
  const onSuccess = async (dto: ExpenseDto) => {
    await invalidateGroup(qc, groupId, 'all');
    qc.removeQueries({ queryKey: qk.expense(dto.id) });
  };
  const upload = useMutation({ mutationFn: uploadReceipt, onSuccess });
  const remove = useMutation({ mutationFn: (expenseId: string) => api<ExpenseDto>('DELETE', receiptUrl(expenseId)), onSuccess });
  return { upload: upload.mutateAsync, remove: remove.mutateAsync, busy: upload.isPending || remove.isPending };
}
