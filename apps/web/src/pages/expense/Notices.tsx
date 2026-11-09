import { byGender, expenseEffect, type ExpenseDto, type GroupDto, type LedgerExpense } from '@se/shared';
import { Link } from 'react-router';
import { copy } from '../../lib/copy.js';
import { CATEGORY_LABELS, money, moneyCur, shortDate } from '../../lib/format.js';
import type { ConflictAction } from '../../lib/queries/index.js';

const nameIn = (g: GroupDto, id: string) => g.members.find((m) => m.userId === id)?.name ?? 'Бывший участник';
const signClass = (v: number) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');

/** D03: как изменятся балансы после сохранения правки. Текущие балансы − старый расход + новый. */
export function EditPreview(p: { g: GroupDto; meId: string; before: { userId: string; amount: number }[]; oldExpense: ExpenseDto; newExpense: LedgerExpense }) {
  const oldEffect = expenseEffect(p.oldExpense);
  const newEffect = expenseEffect(p.newExpense);
  const rows = p.before.map((b) => ({ ...b, after: b.amount - (oldEffect.get(b.userId) ?? 0) + (newEffect.get(b.userId) ?? 0) }));
  if (rows.every((r) => r.after === r.amount)) return null;
  return (
    <div className="preview">
      <p style={{ fontWeight: 600 }}>{copy.expense.editPreviewTitle}</p>
      <table>
        <thead>
          <tr>
            <th>Участник</th>
            <th className="num">Сейчас</th>
            <th className="num">Станет</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PreviewRow key={r.userId} g={p.g} isMe={r.userId === p.meId} userId={r.userId} now={r.amount} after={r.after} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewRow(p: { g: GroupDto; isMe: boolean; userId: string; now: number; after: number }) {
  const same = p.after === p.now;
  const name = nameIn(p.g, p.userId);
  return (
    <tr style={p.isMe ? { fontWeight: 600 } : undefined}>
      <td>{p.isMe ? `Ты (${name})` : name}</td>
      <td className="num n">{money(p.now, p.g.currency, true)}</td>
      {same ? (
        <td className="num n text-2" style={{ fontWeight: 400 }}>
          без изменений
        </td>
      ) : (
        <td className={`num n ${signClass(p.after)}`} style={{ fontWeight: 600 }}>
          {money(p.after, p.g.currency, true)}
        </td>
      )}
    </tr>
  );
}

/**
 * Пока форма была открыта, расход изменили или удалили (409). Упрощённая версия ConflictSheet из S03:
 * показываем, что сейчас в базе, и даём выбор. Полный экран с двумя карточками — вместе с реалтаймом.
 */
export function ConflictNotice(p: { g: GroupDto; current: ExpenseDto | null; meId: string; busy: boolean; action: ConflictAction; onOverwrite: () => void }) {
  const { g, current, meId, busy, onOverwrite } = p;
  if (!current) {
    return (
      <div className="warn" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <strong>Этот расход уже удалили, пока была открыта форма.</strong>
        <Link to={`/groups/${g.id}`} className="btn btn--sm" style={{ alignSelf: 'flex-start' }}>
          К группе
        </Link>
      </div>
    );
  }
  const author = g.members.find((m) => m.userId === current.updatedBy);
  const who = current.updatedBy === meId ? 'ты в другой вкладке' : (author?.name ?? 'кто-то');
  return (
    <div className="warn" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong>
        Пока форма была открыта, {who} {byGender(author?.gender, 'изменил', 'изменила')} этот расход.
      </strong>
      <span>
        Сейчас: «{current.title || CATEGORY_LABELS[current.category]}», <span className="n">{moneyCur(current.amount, g.currency)}</span>, {shortDate(current.spentOn)}.
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={onOverwrite}>
          {p.action === 'delete' ? 'Всё равно удалить' : copy.live.conflictApply}
        </button>
        <Link to={`/groups/${g.id}`} className="btn btn--sm">
          Оставить как есть
        </Link>
      </div>
    </div>
  );
}
