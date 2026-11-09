import type { ExpenseDto, ExpenseInput, GroupDto } from '@se/shared';
import { useNavigate } from 'react-router';
import { useToast, type ToastContent } from '../../components/Toast.js';
import { errorText, useExpenseEditor, useReceiptMutations } from '../../lib/queries/index.js';
import type { ReceiptChange } from '../../lib/receipts.js';
import { clearDraft } from './draftStore.js';

/**
 * Сохранение и удаление расхода из формы: запросы и конфликты версий — в слое запросов, здесь тост и переход.
 * Чек — отдельным запросом после сохранения расхода (новому расходу нужен id). Если чек не прошёл,
 * расход всё равно сохранён: говорим об этом в тосте, а не держим человека в форме.
 */
export function useExpenseMutations(g: GroupDto, expense: ExpenseDto | undefined) {
  const toast = useToast();
  const navigate = useNavigate();
  const editor = useExpenseEditor(g.id, expense);
  const receipts = useReceiptMutations(g.id);

  async function finish(done: string | ToastContent) {
    if (!expense) clearDraft(g.id);
    toast(done);
    await navigate(`/groups/${g.id}`);
  }

  /**
   * null — с чеком всё хорошо (или делать ничего не надо), иначе тост «Расход сохранён, а чек не загрузился»
   * с ответом сервера и ссылкой на расход, чтобы приложить ещё раз. Живой тост висит дольше простого.
   */
  async function applyReceipt(saved: ExpenseDto, change: ReceiptChange): Promise<ToastContent | null> {
    try {
      if (change instanceof File) await receipts.upload({ expenseId: saved.id, file: change });
      else if (change === 'remove' && saved.receipt) await receipts.remove(saved.id);
      return null;
    } catch (err) {
      const verb = change === 'remove' ? 'не удалился' : 'не загрузился';
      return {
        text: `${expense ? 'Изменения сохранены' : 'Расход сохранён'}, а чек ${verb}`,
        sub: errorText(err),
        action: { label: 'К расходу', to: `/groups/${g.id}/expenses/${saved.id}` },
      };
    }
  }

  return {
    busy: editor.busy || receipts.busy,
    error: editor.error,
    conflict: editor.conflict,
    async save(input: ExpenseInput, receipt: ReceiptChange, version?: number) {
      const saved = await editor.save(input, version);
      if (!saved) return;
      const problem = await applyReceipt(saved, receipt);
      await finish(problem ?? (expense ? 'Изменения сохранены' : 'Расход добавлен'));
    },
    async remove(version?: number) {
      if (await editor.remove(version)) await finish('Расход удалён');
    },
  };
}

export type Mutations = ReturnType<typeof useExpenseMutations>;
