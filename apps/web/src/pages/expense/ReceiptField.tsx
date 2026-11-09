import type { ExpenseDto, GroupDto } from '@se/shared';
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.js';
import { copy } from '../../lib/copy.js';
import { fileSize } from '../../lib/format.js';
import { receiptUrl } from '../../lib/queries/index.js';
import { RECEIPT_ACCEPT, receiptProblem, type ReceiptChange } from '../../lib/receipts.js';

/** «Открыть» — файл чека в новой вкладке. */
export const OpenReceipt = ({ expenseId }: { expenseId: string }) => (
  <a href={receiptUrl(expenseId)} target="_blank" rel="noopener noreferrer" className="link">
    Открыть
  </a>
);

function FileLine({ name, size, children }: { name: string; size: number; children: ReactNode }) {
  return (
    <div className="receipt-file">
      <Icon name="clip" size={18} />
      <span className="receipt-file__name">
        <span className="receipt-file__title">{name}</span>
        <span className="hint-sm n">{fileSize(size)}</span>
      </span>
      <span className="receipt-file__actions">{children}</span>
    </div>
  );
}

interface Props {
  g: GroupDto;
  expense: ExpenseDto | undefined;
  change: ReceiptChange;
  onChange: (c: ReceiptChange) => void;
}

/**
 * Чек в форме расхода (M04–M06, D03): пунктирная кнопка «Чек» рядом с «Комментарием», выбранный файл
 * с «Убрать», у сохранённого расхода — текущий чек с «Открыть», «Заменить» и «Удалить».
 * Отправляется при сохранении формы. В закрытой группе остаётся только «Открыть».
 */
export function ReceiptField({ g, expense, change, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const current = expense?.receipt ?? null;
  if (g.status !== 'open') {
    if (!current || !expense) return null;
    return (
      <FileLine name={current.name} size={current.size}>
        <OpenReceipt expenseId={expense.id} />
      </FileLine>
    );
  }

  const pick = () => input.current?.click();
  const picker = (
    <input
      ref={input}
      type="file"
      accept={RECEIPT_ACCEPT}
      hidden
      aria-label="Файл чека"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // тот же файл можно выбрать ещё раз
        if (!file) return;
        const p = receiptProblem(file);
        setProblem(p);
        if (!p) onChange(file);
      }}
    />
  );
  return (
    <>
      {picker}
      <ReceiptState expense={expense} change={change} onChange={onChange} onPick={pick} />
      {problem && <span className="field-error receipt-error">{problem}</span>}
    </>
  );
}

function ReceiptState({ expense, change, onChange, onPick }: Omit<Props, 'g'> & { onPick: () => void }) {
  const current = expense?.receipt ?? null;
  const action = (label: string, onClick: () => void) => (
    <button type="button" className="link" onClick={onClick}>
      {label}
    </button>
  );
  if (change instanceof File) {
    return (
      <FileLine name={change.name} size={change.size}>
        {action('Убрать', () => {
          onChange('keep');
        })}
      </FileLine>
    );
  }
  if (!current || !expense) {
    return (
      <button type="button" className="btn dashed-btn" onClick={onPick}>
        <Icon name="clip" size={18} />
        {copy.expense.receipt}
      </button>
    );
  }
  if (change === 'remove') {
    return (
      <div className="receipt-file receipt-file--removed">
        <span className="receipt-file__name hint">Чек удалится, когда сохранишь</span>
        <span className="receipt-file__actions">
          {action('Вернуть', () => {
            onChange('keep');
          })}
        </span>
      </div>
    );
  }
  return (
    <FileLine name={current.name} size={current.size}>
      <OpenReceipt expenseId={expense.id} />
      {action('Заменить', onPick)}
      {action('Удалить', () => {
        onChange('remove');
      })}
    </FileLine>
  );
}
