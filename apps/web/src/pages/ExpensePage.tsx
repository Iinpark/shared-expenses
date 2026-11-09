import { canEditExpense, currencySymbol, EXPENSE_CATEGORIES, formatAmount, type CurrencyCode, type ExpenseDto, type GroupDto } from '@se/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Icon } from '../components/Icon.js';
import { copy, fill } from '../lib/copy.js';
import { CATEGORY_LABELS, money, moneyCur, today } from '../lib/format.js';
import { ApiError, useBalances, useCurrentUser, useExpense, useGroup } from '../lib/queries/index.js';
import { useExpenseDraft, type Draft } from './expense/draft.js';
import { useExpenseMutations, type Mutations } from './expense/mutations.js';
import { clearDraft } from './expense/draftStore.js';
import { ConflictSheet, EditPreview, FormNotice, useFormNotice, type VersionView } from './expense/Notices.js';
import { SplitSection } from './expense/SplitSection.js';
import { NotFoundPage } from './NotFoundPage.js';

/** M04–M06 (новый расход) и D03 (правка). Маршруты /groups/:id/expenses/new и /groups/:id/expenses/:expenseId. */
export function ExpensePage() {
  const { id = '', expenseId } = useParams();
  const me = useCurrentUser();
  const group = useGroup(id);
  const existing = useExpense(expenseId);

  const notFound = (e: unknown) => e instanceof ApiError && e.status === 404;
  if (notFound(group.error) || notFound(existing.error)) return <NotFoundPage />;
  if (!group.data || (expenseId && !existing.data)) return <p className="hint" style={{ padding: 20 }}>Загружаем…</p>;
  return <Editor key={existing.data?.id ?? 'new'} g={group.data} expense={existing.data} meId={me.id} />;
}

/**
 * Форма или объяснение, почему её нет. Форму, которую уже начали заполнять, не убираем, если группу закрыли:
 * над ней появится объяснение, а набранное останется (новый расход — и в черновике на телефоне).
 */
function Editor({ g, expense, meId }: { g: GroupDto; expense: ExpenseDto | undefined; meId: string }) {
  const [formShown, setFormShown] = useState(false);
  const blocked = readOnlyReason(g, expense, meId, formShown);
  if (blocked) return <ReadOnly groupId={g.id} text={blocked} />;
  if (!formShown) setFormShown(true);
  return <ExpenseForm group={g} expense={expense} />;
}

/** Почему форму не показываем: группа закрыта или расход чужой (править может плативший, автор или создатель группы). */
function readOnlyReason(g: GroupDto, expense: ExpenseDto | undefined, meId: string, formShown: boolean): string | null {
  if (g.status === 'closed' && !formShown) return 'Группа закрыта, расходы не изменить.';
  if (expense && !canEditExpense(expense, meId, g.ownerId)) return 'Изменить расход может тот, кто платил, кто его внёс, или создатель группы.';
  return null;
}

function ReadOnly({ groupId, text }: { groupId: string; text: string }) {
  return (
    <div className="solo">
      <p className="empty__title">{text}</p>
      <Link to={`/groups/${groupId}`} className="btn btn--outline" style={{ marginTop: 16 }}>
        К группе
      </Link>
    </div>
  );
}

function ExpenseForm({ group: g, expense }: { group: GroupDto; expense?: ExpenseDto }) {
  const me = useCurrentUser();
  const balances = useBalances(g.id);
  const d = useExpenseDraft(g, expense, me.id);
  const m = useExpenseMutations(g, expense);
  const notice = useFormNotice(g, me.id, expense?.id);
  const canSave = isSavable(g, d, m.busy);
  const save = (version?: number) => {
    if (d.total !== null) void m.save(d.input(d.total), version);
  };

  return (
    <div className="expense-form">
      <FormHeader g={g} editing={!!expense} />
      {notice && <FormNotice text={notice} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
        style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
      >
        <div className="form-section" style={{ gap: 16 }}>
          <AmountField d={d} expense={expense} />
          <DetailsFields d={d} g={g} meId={me.id} />
        </div>
        <div className="form-section" style={{ gap: 14, paddingTop: 20 }}>
          <SplitSection d={d} g={g} meId={me.id} />
          <CommentField d={d} initiallyOpen={!!expense?.comment} />
        </div>
        {expense && d.shares && d.total !== null && balances.data && (
          <div className="form-section" style={{ paddingTop: 20 }}>
            <EditPreview g={g} meId={me.id} before={balances.data.balances} oldExpense={expense} newExpense={{ payerId: d.payerId, amount: d.total, shares: d.shares }} />
          </div>
        )}
        <FormFoot g={g} d={d} m={m} editing={!!expense} canSave={canSave} meId={me.id} onSave={save} />
      </form>
    </div>
  );
}

const isSavable = (g: GroupDto, d: Draft, busy: boolean) => g.status === 'open' && !!d.shares && !d.exactBad && !busy;

function FormHeader({ g, editing }: { g: GroupDto; editing: boolean }) {
  return (
    <header className="sheet-head">
      <Link
        to={`/groups/${g.id}`}
        aria-label="Закрыть"
        className="icon-btn"
        onClick={() => {
          // Закрыть крестиком — значит передумать: черновик нового расхода больше не нужен.
          if (!editing) clearDraft(g.id);
        }}
      >
        <Icon name="close" size={24} />
      </Link>
      <div className="sheet-head__title" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span>{editing ? copy.expense.edit : copy.expense.new}</span>
        <span className="hint-sm" style={{ fontWeight: 400 }}>
          {g.name}
        </span>
      </div>
    </header>
  );
}

function AmountField({ d, expense }: { d: Draft; expense: ExpenseDto | undefined }) {
  return (
    <label className="amount-field">
      <span className="field__label">{fill(copy.expense.amount, { currency: currencySymbol(d.currency) })}</span>
      <input
        className="amount-input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={d.amountText}
        onChange={(e) => {
          d.setAmountText(e.target.value);
        }}
        onBlur={() => {
          if (d.total !== null) d.setAmountText(formatAmount(d.total, d.currency));
        }}
        autoFocus={!expense}
        aria-invalid={!!d.amountText && d.total === null}
      />
      {expense && d.total !== expense.amount && <span className="amount-was">было {money(expense.amount, d.currency)}</span>}
      {d.tooBig && <span className="field-error">Слишком большая сумма</span>}
      {!!d.amountText && d.parsed === null && <span className="field-error">Похоже, в сумме опечатка</span>}
    </label>
  );
}

function DetailsFields({ d, g, meId }: { d: Draft; g: GroupDto; meId: string }) {
  return (
    <>
      <label className="field">
        <span className="field__label">
          {copy.expense.what} <span style={{ color: 'var(--ink-4)' }}>· {copy.expense.optional}</span>
        </span>
        <input
          className="input"
          value={d.title}
          maxLength={80}
          onChange={(e) => {
            d.setTitle(e.target.value);
          }}
          placeholder="Например, ужин"
        />
      </label>

      <div className="cat-chips" role="group" aria-label={copy.expense.category}>
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="cat-chip"
            aria-pressed={d.category === c}
            onClick={() => {
              d.setCategory(c);
            }}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="boxes">
        <label className="box">
          <span className="box__label">{copy.expense.paidBy}</span>
          <select
            value={d.payerId}
            onChange={(e) => {
              d.setPayerId(e.target.value);
            }}
          >
            {g.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === meId ? `Ты (${m.name})` : m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="box">
          <span className="box__label">{copy.expense.when}</span>
          <input
            type="date"
            value={d.spentOn}
            max="2100-01-01"
            onChange={(e) => {
              d.setSpentOn(e.target.value || today());
            }}
          />
        </label>
      </div>
    </>
  );
}

function CommentField({ d, initiallyOpen }: { d: Draft; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!open) {
    return (
      <button
        type="button"
        className="btn dashed-btn"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="plus" size={18} />
        {copy.expense.comment}
      </button>
    );
  }
  return (
    <label className="field">
      <span className="field__label">{copy.expense.comment}</span>
      <textarea
        className="input"
        style={{ height: 88, padding: '10px 14px', resize: 'vertical' }}
        maxLength={500}
        value={d.comment}
        onChange={(e) => {
          d.setComment(e.target.value);
        }}
      />
    </label>
  );
}

function submitLabel(editing: boolean, total: number | null, currency: CurrencyCode): string {
  if (editing) return 'Сохранить изменения';
  return total ? fill(copy.expense.save, { amount: moneyCur(total, currency) }) : 'Сохранить';
}

/** Несохранённая форма как версия расхода для ConflictSheet. */
function mineVersion(d: Draft): VersionView | null {
  if (d.total === null) return null;
  const input = d.input(d.total);
  return { title: input.title ?? '', amount: d.total, payerId: d.payerId, shareIds: (d.shares ?? []).map((s) => s.userId), spentOn: d.spentOn };
}

interface FootProps {
  g: GroupDto;
  d: Draft;
  m: Mutations;
  editing: boolean;
  canSave: boolean;
  meId: string;
  onSave: (version?: number) => void;
}

/** ConflictSheet поверх формы, если сохранение или удаление вернуло 409. */
function FormConflict({ g, d, m, meId, onSave }: FootProps) {
  const conflict = m.conflict;
  if (!conflict) return null;
  const overwrite = () => {
    if (!conflict.current) return;
    if (conflict.action === 'delete') void m.remove(conflict.current.version);
    else onSave(conflict.current.version);
  };
  return (
    <ConflictSheet
      g={g}
      current={conflict.current}
      meId={meId}
      meGender={g.members.find((x) => x.userId === meId)?.gender ?? null}
      busy={m.busy}
      action={conflict.action}
      mine={conflict.action === 'delete' ? null : mineVersion(d)}
      onApply={overwrite}
    />
  );
}

function FormFoot(p: FootProps) {
  const { d, m } = p;
  const conflict = m.conflict;
  return (
    <div className="form-foot">
      <FormConflict {...p} />
      {m.error && <p className="form-error">{m.error}</p>}
      <button type="submit" className="btn btn--primary btn--main" disabled={!p.canSave || !!conflict}>
        {submitLabel(p.editing, d.total, d.currency)}
      </button>
      {d.mode === 'exact' && !d.shares && !!d.total && (
        <p className="hint-sm" style={{ textAlign: 'center' }}>
          {copy.expense.exactBlocked}
        </p>
      )}
      {p.editing && p.g.status === 'open' && <DeleteControl busy={m.busy} onDelete={() => void m.remove()} />}
    </div>
  );
}

/** «Удалить расход» с подтверждением прямо на месте. */
function DeleteControl({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button
        type="button"
        className="danger-link"
        style={{ marginTop: 12, alignSelf: 'center' }}
        onClick={() => {
          setConfirm(true);
        }}
      >
        {copy.expense.delete}
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 8 }}>
      <span className="hint">Удалить расход для всех?</span>
      <button type="button" className="btn btn--sm" style={{ borderColor: 'var(--minus)', color: 'var(--minus-strong)' }} onClick={onDelete} disabled={busy}>
        Удалить
      </button>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => {
          setConfirm(false);
        }}
      >
        Отмена
      </button>
    </div>
  );
}
