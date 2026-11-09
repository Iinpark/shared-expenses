import { byGender, currencySymbol, must, parseAmount, type CurrencyCode, type GroupDto, type ShareResult } from '@se/shared';
import { Icon } from '../../components/Icon.js';
import { copy, fill } from '../../lib/copy.js';
import { money } from '../../lib/expenses.js';
import { joinNames, plural } from '../../lib/ru.js';
import type { Draft } from './draft.js';

const nameIn = (g: GroupDto, id: string) => g.members.find((m) => m.userId === id)?.name ?? 'Бывший участник';

/** Сверка долей с суммой: ReconcileLine, а для точных сумм — ReconcileError с быстрым исправлением (M06). */
export function Reconcile({ d, g, meId }: { d: Draft; g: GroupDto; meId: string }) {
  if (!d.total) return null;
  if (d.mode === 'exact' && !d.shares) {
    if (d.exactBad) return <p className="form-error">Похоже, в одной из сумм опечатка</p>;
    return <ExactMismatch d={d} g={g} total={d.total} />;
  }
  if (!d.shares) return d.splitError ? <p className="form-error">{d.splitError}</p> : null;
  return <ReconcileOk d={d} g={g} total={d.total} shares={d.shares} meId={meId} />;
}

function ExactMismatch({ d, g, total }: { d: Draft; g: GroupDto; total: number }) {
  const currency = d.currency;
  const valueOf = (id: string) => parseAmount(d.exact[id] ?? '', currency) ?? 0;
  const allocated = d.memberIds.reduce((s, id) => s + valueOf(id), 0);
  const diff = total - allocated;
  // Разницу — тому, чью сумму меняли последней, а если ещё никого — последнему в списке.
  const target = d.lastEdited ?? must(d.memberIds.at(-1), 'участник группы');
  const fixed = valueOf(target) + diff;
  const what = diff > 0 ? `Добавить ${money(diff, currency)}` : `Убрать ${money(-diff, currency)}`;
  return (
    <div className="reconcile reconcile--error" role="alert">
      <div className="reconcile__line">
        <span>{copy.expense.exactTotal}</span>
        <span className="n">{money(total, currency)}</span>
      </div>
      <div className="reconcile__line">
        <span>{copy.expense.exactAllocated}</span>
        <span className="n">{money(allocated, currency)}</span>
      </div>
      <div className="reconcile__line reconcile__line--strong">
        <span>{diff > 0 ? copy.expense.exactMissing : copy.expense.exactOver}</span>
        <span className="n">{money(Math.abs(diff), currency)}</span>
      </div>
      {fixed >= 0 && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            d.fixExact(target, fixed);
          }}
        >
          {what} → {nameIn(g, target)}
        </button>
      )}
    </div>
  );
}

function ReconcileOk({ d, g, total, shares, meId }: { d: Draft; g: GroupDto; total: number; shares: ShareResult[]; meId: string }) {
  return (
    <div className="reconcile">
      {d.mode === 'shares' && <SharesSummary shares={shares} total={total} currency={d.currency} meId={meId} />}
      <span className="reconcile__ok">
        <Icon name="check" size={16} />
        <span className="n">{fill(copy.expense.check, { amount: money(total, d.currency) })}</span>
      </span>
      <RemainderNote g={g} total={total} shares={shares} currency={d.currency} />
    </div>
  );
}

/** Полоска долей (ShareBar) и «5 долей по 400,00», если делится ровно. */
function SharesSummary({ shares, total, currency, meId }: { shares: ShareResult[]; total: number; currency: CurrencyCode; meId: string }) {
  const weightSum = shares.reduce((s, x) => s + (x.weight ?? 0), 0);
  return (
    <>
      <div className="share-bar" aria-hidden="true">
        {shares.map((s) => (
          <span key={s.userId} className={s.userId === meId ? 'me' : ''} style={{ flex: s.weight ?? 1 }} />
        ))}
      </div>
      {total % weightSum === 0 && (
        <span className="n">
          {weightSum} {plural(weightSum, 'доля', 'доли', 'долей')} по {money(total / weightSum, currency)}
        </span>
      )}
    </>
  );
}

/** Кто получил лишние копейки и почему он. */
function RemainderNote({ g, total, shares, currency }: { g: GroupDto; total: number; shares: ShareResult[]; currency: CurrencyCode }) {
  const extras = shares.filter((s) => s.extra);
  const [first] = extras;
  if (!first) return null;
  const who =
    extras.length === 1
      ? `получает ${nameIn(g, first.userId)}: ${byGender(g.members.find((m) => m.userId === first.userId)?.gender, 'он', 'она')} раньше всех в списке группы.`
      : `получают ${joinNames(extras.map((e) => nameIn(g, e.userId)))}, по ${money(1, currency)}: они раньше всех в списке группы.`;
  return (
    <span>
      {money(total, currency)} на {shares.length} не делится ровно. Остаток {money(extras.length, currency)} {currencySymbol(currency)} {who} Правило одно для всех
      расходов.
    </span>
  );
}
