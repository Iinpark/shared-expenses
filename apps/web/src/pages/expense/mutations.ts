import type { ExpenseDto, ExpenseInput, GroupDto } from '@se/shared';
import { useNavigate } from 'react-router';
import { useToast } from '../../components/Toast.js';
import { useExpenseEditor } from '../../lib/queries/index.js';
import { clearDraft } from './draftStore.js';

/** Сохранение и удаление расхода из формы: запросы и конфликты версий — в слое запросов, здесь тост и переход. */
export function useExpenseMutations(g: GroupDto, expense: ExpenseDto | undefined) {
  const toast = useToast();
  const navigate = useNavigate();
  const editor = useExpenseEditor(g.id, expense);

  async function finish(ok: boolean, done: string) {
    if (!ok) return;
    if (!expense) clearDraft(g.id);
    toast(done);
    await navigate(`/groups/${g.id}`);
  }

  return {
    busy: editor.busy,
    error: editor.error,
    conflict: editor.conflict,
    async save(input: ExpenseInput, version?: number) {
      await finish(await editor.save(input, version), expense ? 'Изменения сохранены' : 'Расход добавлен');
    },
    async remove(version?: number) {
      await finish(await editor.remove(version), 'Расход удалён');
    },
  };
}

export type Mutations = ReturnType<typeof useExpenseMutations>;
