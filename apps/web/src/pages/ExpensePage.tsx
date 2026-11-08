import {
  amountToInput,
  byGender,
  computeShares,
  currencySymbol,
  EXPENSE_CATEGORIES,
  expenseEffect,
  formatAmount,
  parseAmount,
  SplitError,
  type CurrencyCode,
  type ExpenseCategory,
  type ExpenseConflictBody,
  type ExpenseDto,
  type ExpenseInput,
  type GroupDto,
  type ShareResult,
  type SplitInput,
  type SplitMode,
} from '@se/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { api, ApiError, errorText } from '../lib/api.js';
import { copy, fill } from '../lib/copy.js';
import { CATEGORY_LABELS, invalidateGroup, money, moneyCur, shortDate, today, useBalances } from '../lib/expenses.js';
import { useGroup } from '../lib/groups.js';
import { joinNames, plural } from '../lib/ru.js';
import { useMe } from '../lib/session.js';
import { NotFoundPage } from './NotFoundPage.js';

/** M04–M06 (новый расход) и D03 (правка). Маршруты /groups/:id/expenses/new и /groups/:id/expenses/:expenseId. */
export function ExpensePage() {
  const { id = '', expenseId } = useParams();
  const group = useGroup(id);
  const existing = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => api<ExpenseDto>('GET', `/api/expenses/${expenseId}`),
    enabled: !!expenseId,
    retry: false,
    staleTime: 0,
  });

  const notFound = (e: unknown) => e instanceof ApiError && e.status === 404;
  if (notFound(group.error) || notFound(existing.error)) return <NotFoundPage />;
  if (!group.data || (expenseId && !existing.data)) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  if (group.data.status === 'closed') {
    return (
      <div className="solo">
        <p className="empty__title">Группа закрыта, расходы не изменить.</p>
        <Link to={`/groups/${id}`} className="btn btn--outline" style={{ marginTop: 16 }}>
          К группе
        </Link>
      </div>
    );
  }
  return <ExpenseForm key={existing.data?.id ?? 'new'} group={group.data} expense={existing.data} />;
}

type Weights = Record<string, number>;
type Texts = Record<string, string>;

function ExpenseForm({ group: g, expense }: { group: GroupDto; expense?: ExpenseDto }) {
  const me = useMe().data!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const balances = useBalances(g.id);
  const currency = g.currency as CurrencyCode;
  const members = g.members;
  const joinOrder = useMemo(() => new Map(members.map((m) => [m.userId, m.joinOrder])), [members]);
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? 'Бывший участник';
  const shareOf = (userId: string) => expense?.shares.find((s) => s.userId === userId);

  const [amountText, setAmountText] = useState(expense ? amountToInput(expense.amount, currency) : '');
  const [title, setTitle] = useState(expense?.title ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'other');
  const [payerId, setPayerId] = useState(expense?.payerId ?? me.id);
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? today());
  const [comment, setComment] = useState(expense?.comment ?? '');
  const [showComment, setShowComment] = useState(!!expense?.comment);
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? 'equal');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(expense?.splitMode === 'equal' ? expense.shares.map((s) => s.userId) : members.map((m) => m.userId)),
  );
  const [weights, setWeights] = useState<Weights>(() =>
    Object.fromEntries(members.map((m) => [m.userId, expense?.splitMode === 'shares' ? (shareOf(m.userId)?.weight ?? 0) : 1])),
  );
  const [exact, setExact] = useState<Texts>(() =>
    Object.fromEntries(
      members.map((m) => {
        const s = expense?.splitMode === 'exact' ? shareOf(m.userId) : undefined;
        return [m.userId, s ? amountToInput(s.amount, currency) : ''];
      }),
    ),
  );
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: ExpenseDto | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const total = parseAmount(amountText, currency);
  const split: SplitInput =
    mode === 'equal'
      ? { mode, userIds: members.filter((m) => selected.has(m.userId)).map((m) => m.userId) }
      : mode === 'shares'
        ? { mode, shares: members.map((m) => ({ userId: m.userId, weight: weights[m.userId] ?? 0 })) }
        : { mode, shares: members.map((m) => ({ userId: m.userId, amount: parseAmount(exact[m.userId] ?? '', currency) ?? 0 })) };

  // Превью долей считает тот же код, что и сервер (packages/shared/src/split.ts).
  let shares: ShareResult[] | null = null;
  let splitError: string | null = null;
  if (total && total > 0) {
    try {
      shares = computeShares(total, split, joinOrder);
    } catch (err) {
      splitError = err instanceof SplitError ? err.message : errorText(err);
    }
  }
  const shareAmount = (userId: string) => shares?.find((s) => s.userId === userId)?.amount;
  const exactBad = mode === 'exact' && members.some((m) => (exact[m.userId] ?? '').trim() && parseAmount(exact[m.userId]!, currency) === null);
  const canSave = !!shares && !exactBad && !busy;

  function input(): ExpenseInput {
    const autoTitle = fill(copy.expense.autoName, { time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) });
    return {
      amount: total!,
      title: title.trim() || (category === 'other' ? autoTitle : CATEGORY_LABELS[category]),
      category,
      payerId,
      spentOn,
      comment: comment.trim() || null,
      split,
    };
  }

  async function save(version = expense?.version) {
    setBusy(true);
    setError(null);
    try {
      if (expense) await api<ExpenseDto>('PUT', `/api/expenses/${expense.id}`, { ...input(), version });
      else await api<ExpenseDto>('POST', `/api/groups/${g.id}/expenses`, input());
      await invalidateGroup(qc, g.id);
      qc.removeQueries({ queryKey: ['expense', expense?.id] });
      toast(expense ? 'Изменения сохранены' : 'Расход добавлен');
      navigate(`/groups/${g.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.code === 'version_conflict' || err.code === 'expense_deleted')) {
        setConflict({ current: (err.body as ExpenseConflictBody | undefined)?.current ?? null });
        void invalidateGroup(qc, g.id); // превью балансов должно считаться от свежих цифр
      } else if (err instanceof ApiError && err.status === 404 && expense) {
        setConflict({ current: null });
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!expense) return;
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/api/expenses/${expense.id}?version=${expense.version}`);
      await invalidateGroup(qc, g.id);
      toast('Расход удалён');
      navigate(`/groups/${g.id}`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) setConflict({ current: (err.body as ExpenseConflictBody | undefined)?.current ?? null });
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const symbol = currencySymbol(currency);

  return (
    <div className="expense-form">
      <header className="sheet-head">
        <Link to={`/groups/${g.id}`} aria-label="Закрыть" className="icon-btn">
          <Icon name="close" size={24} />
        </Link>
        <div className="sheet-head__title" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span>{expense ? copy.expense.edit : copy.expense.new}</span>
          <span className="hint-sm" style={{ fontWeight: 400 }}>
            {g.name}
          </span>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
        style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
      >
        <div className="form-section" style={{ gap: 16 }}>
          <label className="amount-field">
            <span className="field__label">{fill(copy.expense.amount, { currency: symbol })}</span>
            <input
              className="amount-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => total !== null && setAmountText(formatAmount(total, currency))}
              autoFocus={!expense}
              aria-invalid={!!amountText && total === null}
            />
            {expense && total !== expense.amount && <span className="amount-was">было {money(expense.amount, currency)}</span>}
            {!!amountText && total === null && <span className="field-error">Похоже, в сумме опечатка</span>}
          </label>

          <label className="field">
            <span className="field__label">
              {copy.expense.what} <span style={{ color: 'var(--ink-4)' }}>· {copy.expense.optional}</span>
            </span>
            <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Например, ужин" />
          </label>

          <div className="cat-chips" role="group" aria-label={copy.expense.category}>
            {EXPENSE_CATEGORIES.map((c) => (
              <button key={c} type="button" className="cat-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="boxes">
            <label className="box">
              <span className="box__label">{copy.expense.paidBy}</span>
              <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me.id ? `Ты (${m.name})` : m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="box">
              <span className="box__label">{copy.expense.when}</span>
              <input type="date" value={spentOn} max="2100-01-01" onChange={(e) => setSpentOn(e.target.value || today())} />
            </label>
          </div>
        </div>

        <div className="form-section" style={{ gap: 14, paddingTop: 20 }}>
          <span className="field__label--strong" style={{ fontWeight: 600, fontSize: 16 }}>
            {copy.expense.splitTitle}
          </span>
          <div className="segments" role="radiogroup" aria-label={copy.expense.splitTitle}>
            {(['equal', 'shares', 'exact'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                {copy.expense.splitModes[m]}
              </button>
            ))}
          </div>

          <div className="split-list">
            {members.map((m) => {
              const isMe = m.userId === me.id;
              const label = isMe ? `${m.name} (ты)` : m.name;
              const amount = shareAmount(m.userId);
              const extra = shares?.find((s) => s.userId === m.userId)?.extra;

              if (mode === 'equal') {
                const on = selected.has(m.userId);
                return (
                  <label key={m.userId} className={`split-row${on ? '' : ' split-row--off'}`}>
                    <span className="split-row__name">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = new Set(selected);
                          if (on) next.delete(m.userId);
                          else next.add(m.userId);
                          setSelected(next);
                        }}
                      />
                      <span>
                        {label} {on && extra && <span className="extra-cent">{extraLabel(currency)}</span>}
                      </span>
                    </span>
                    {on ? <span className="n split-row__amount">{amount !== undefined ? money(amount, currency) : '—'}</span> : <span className="hint-sm">{copy.expense.notParticipating}</span>}
                  </label>
                );
              }

              if (mode === 'shares') {
                const w = weights[m.userId] ?? 0;
                const setW = (v: number) => setWeights({ ...weights, [m.userId]: Math.max(0, Math.min(99, v)) });
                return (
                  <div key={m.userId} className={`split-row${w ? '' : ' split-row--off'}`}>
                    <span className="split-row__name" style={isMe ? { fontWeight: 600 } : undefined}>
                      {label}
                    </span>
                    <span className={`stepper${isMe ? ' stepper--me' : ''}`}>
                      <button type="button" aria-label={`Меньше долей: ${m.name}`} onClick={() => setW(w - 1)} disabled={w === 0}>
                        −
                      </button>
                      <span className="n" aria-label={`Долей: ${w}`}>
                        {w}
                      </span>
                      <button type="button" aria-label={`Больше долей: ${m.name}`} onClick={() => setW(w + 1)}>
                        +
                      </button>
                    </span>
                    <span className="n split-row__amount" style={{ minWidth: 88, textAlign: 'right' }}>
                      {w && amount !== undefined ? money(amount, currency) : '—'}
                    </span>
                  </div>
                );
              }

              return (
                <label key={m.userId} className="split-row">
                  <span className="split-row__name">{label}</span>
                  <input
                    className="exact-input"
                    inputMode="decimal"
                    placeholder="0"
                    value={exact[m.userId] ?? ''}
                    aria-label={`Сумма: ${m.name}`}
                    onChange={(e) => {
                      setExact({ ...exact, [m.userId]: e.target.value });
                      setLastEdited(m.userId);
                    }}
                  />
                </label>
              );
            })}
          </div>

          <Reconcile
            mode={mode}
            total={total}
            shares={shares}
            splitError={splitError}
            currency={currency}
            exact={exact}
            exactBad={exactBad}
            members={members.map((m) => m.userId)}
            lastEdited={lastEdited}
            nameOf={nameOf}
            genderOf={(id) => members.find((m) => m.userId === id)?.gender ?? null}
            meId={me.id}
            onFix={(userId, value) => setExact({ ...exact, [userId]: amountToInput(value, currency) })}
          />

          {showComment ? (
            <label className="field">
              <span className="field__label">{copy.expense.comment}</span>
              <textarea className="input" style={{ height: 88, padding: '10px 14px', resize: 'vertical' }} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
          ) : (
            <button type="button" className="btn dashed-btn" onClick={() => setShowComment(true)}>
              <Icon name="plus" size={18} />
              {copy.expense.comment}
            </button>
          )}
        </div>

        {expense && shares && balances.data && (
          <div className="form-section" style={{ paddingTop: 20 }}>
            <EditPreview g={g} meId={me.id} before={balances.data.balances} oldExpense={expense} newExpense={{ payerId, amount: total!, shares }} />
          </div>
        )}

        <div className="form-foot">
          {conflict && <ConflictNotice g={g} current={conflict.current} meId={me.id} busy={busy} onOverwrite={() => conflict.current && void save(conflict.current.version)} />}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--main" disabled={!canSave || !!conflict}>
            {expense ? 'Сохранить изменения' : total ? fill(copy.expense.save, { amount: moneyCur(total, currency) }) : 'Сохранить'}
          </button>
          {mode === 'exact' && !shares && total ? <p className="hint-sm" style={{ textAlign: 'center' }}>{copy.expense.exactBlocked}</p> : null}
          {expense &&
            (confirmDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 8 }}>
                <span className="hint">Удалить расход для всех?</span>
                <button type="button" className="btn btn--sm" style={{ borderColor: 'var(--minus)', color: 'var(--minus-strong)' }} onClick={remove} disabled={busy}>
                  Удалить
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setConfirmDelete(false)}>
                  Отмена
                </button>
              </div>
            ) : (
              <button type="button" className="danger-link" style={{ marginTop: 12, alignSelf: 'center' }} onClick={() => setConfirmDelete(true)}>
                {copy.expense.delete}
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}

/** «+1 коп.» рядом с тем, кому досталась лишняя копейка. */
function extraLabel(currency: CurrencyCode): string {
  if (currency === 'RUB') return '+1 коп.';
  if (currency === 'KZT') return '+1 тиын';
  return `+${money(1, currency)}`;
}

/** Сверка долей с суммой: ReconcileLine, а для точных сумм — ReconcileError с быстрым исправлением (M06). */
function Reconcile(p: {
  mode: SplitMode;
  total: number | null;
  shares: ShareResult[] | null;
  splitError: string | null;
  currency: CurrencyCode;
  exact: Texts;
  exactBad: boolean;
  members: string[];
  lastEdited: string | null;
  nameOf: (id: string) => string;
  genderOf: (id: string) => 'f' | 'm' | null;
  meId: string;
  onFix: (userId: string, value: number) => void;
}) {
  const { total, shares, currency } = p;
  if (!total) return null;

  if (p.mode === 'exact' && !shares) {
    if (p.exactBad) return <p className="form-error">Похоже, в одной из сумм опечатка</p>;
    const allocated = p.members.reduce((s, id) => s + (parseAmount(p.exact[id] ?? '', currency) ?? 0), 0);
    const diff = total - allocated;
    // Разницу — тому, чью сумму меняли последней, а если ещё никого — последнему в списке.
    const target = p.lastEdited ?? p.members.at(-1)!;
    const targetValue = parseAmount(p.exact[target] ?? '', currency) ?? 0;
    const canFix = targetValue + diff >= 0;
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
        {canFix && (
          <button type="button" className="btn" onClick={() => p.onFix(target, targetValue + diff)}>
            {diff > 0 ? `Добавить ${money(diff, currency)} → ${p.nameOf(target)}` : `Убрать ${money(-diff, currency)} → ${p.nameOf(target)}`}
          </button>
        )}
      </div>
    );
  }

  if (!shares) return p.splitError ? <p className="form-error">{p.splitError}</p> : null;

  const extras = shares.filter((s) => s.extra);
  const weightSum = shares.reduce((s, x) => s + (x.weight ?? 0), 0);
  return (
    <div className="reconcile">
      {p.mode === 'shares' && (
        <>
          <div className="share-bar" aria-hidden="true">
            {shares.map((s) => (
              <span key={s.userId} className={s.userId === p.meId ? 'me' : ''} style={{ flex: s.weight ?? 1 }} />
            ))}
          </div>
          {total % weightSum === 0 && (
            <span className="n">
              {weightSum} {plural(weightSum, 'доля', 'доли', 'долей')} по {money(total / weightSum, currency)}
            </span>
          )}
        </>
      )}
      <span className="reconcile__ok">
        <Icon name="check" size={16} />
        <span className="n">{fill(copy.expense.check, { amount: money(total, currency) })}</span>
      </span>
      {extras.length > 0 && (
        <span>
          {money(total, currency)} на {shares.length} не делится ровно. Остаток {money(extras.length, currency)} {currencySymbol(currency)}{' '}
          {extras.length === 1
            ? `получает ${p.nameOf(extras[0]!.userId)}: ${byGender(p.genderOf(extras[0]!.userId), 'он', 'она')} раньше всех в списке группы.`
            : `получают ${joinNames(extras.map((e) => p.nameOf(e.userId)))}, по ${money(1, currency)}: они раньше всех в списке группы.`}{' '}
          Правило одно для всех расходов.
        </span>
      )}
    </div>
  );
}

/** D03: как изменятся балансы после сохранения правки. Текущие балансы − старый расход + новый. */
function EditPreview(p: {
  g: GroupDto;
  meId: string;
  before: { userId: string; amount: number }[];
  oldExpense: ExpenseDto;
  newExpense: { payerId: string; amount: number; shares: { userId: string; amount: number }[] };
}) {
  const oldEffect = expenseEffect(p.oldExpense);
  const newEffect = expenseEffect(p.newExpense);
  const rows = p.before.map((b) => ({ ...b, after: b.amount - (oldEffect.get(b.userId) ?? 0) + (newEffect.get(b.userId) ?? 0) }));
  if (rows.every((r) => r.after === r.amount)) return null;
  const cls = (v: number) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');
  const nameOf = (id: string) => p.g.members.find((m) => m.userId === id)?.name ?? 'Бывший участник';
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
            <tr key={r.userId} style={r.userId === p.meId ? { fontWeight: 600 } : undefined}>
              <td>{r.userId === p.meId ? `Ты (${nameOf(r.userId)})` : nameOf(r.userId)}</td>
              <td className="num n">{money(r.amount, p.g.currency, true)}</td>
              <td className={`num n ${r.after === r.amount ? 'text-2' : cls(r.after)}`} style={r.after === r.amount ? { fontWeight: 400 } : { fontWeight: 600 }}>
                {r.after === r.amount ? 'без изменений' : money(r.after, p.g.currency, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Пока форма была открыта, расход изменили или удалили (409). Упрощённая версия ConflictSheet из S03:
 * показываем, что сейчас в базе, и даём выбор. Полный экран с двумя карточками — вместе с реалтаймом.
 */
function ConflictNotice({ g, current, meId, busy, onOverwrite }: { g: GroupDto; current: ExpenseDto | null; meId: string; busy: boolean; onOverwrite: () => void }) {
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
          {copy.live.conflictApply}
        </button>
        <Link to={`/groups/${g.id}`} className="btn btn--sm">
          Оставить как есть
        </Link>
      </div>
    </div>
  );
}
