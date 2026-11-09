import { receiptUrl } from '../lib/queries/index.js';
import { Icon } from './Icon.js';

/**
 * «📎 чек» в строке расхода (D02). Ссылкой на файл — там, где строка сама не ссылка;
 * внутри строки-ссылки на форму (телефон) — просто отметка: чек откроется из формы.
 */
export function ReceiptMark({ expenseId, link = true }: { expenseId: string; link?: boolean }) {
  const body = (
    <>
      <Icon name="clip" size={13} />
      чек
    </>
  );
  if (!link) return <span className="receipt-mark">{body}</span>;
  return (
    <a className="receipt-mark" href={receiptUrl(expenseId)} target="_blank" rel="noopener noreferrer" aria-label="Открыть чек">
      {body}
    </a>
  );
}
