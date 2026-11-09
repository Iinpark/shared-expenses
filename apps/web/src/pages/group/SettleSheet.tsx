import { amountToInput, currencySymbol, parseAmount, type BalancesDto, type CurrencyCode, type GroupDto, type SettlementDto } from '@se/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { copy, fill } from '../../lib/copy.js';
import { memberOf } from '../../lib/events.js';
import { money, moneyCur } from '../../lib/format.js';
import { errorText, useMarkSettlement } from '../../lib/queries/index.js';
import { allowedTo, balanceOf, pendingFrom, transferAmount } from '../../lib/settlements.js';

/** С чего открыть шит: кому и, для «Отметить снова», какую сумму подставить. */
export interface MarkRequest {
  toId: string;
  amount?: number;
}

interface Props {
  g: GroupDto;
  meId: string;
  balances: BalancesDto;
  settlements: SettlementDto[];
  request: MarkRequest;
  onClose: () => void;
}

type Mode = 'all' | 'part';

const nameOf = (g: GroupDto, id: string) => memberOf(g, id)?.name ?? 'Бывший участник';

/** Проверка суммы: пусто, не число, ноль, больше разрешённого. null — всё хорошо. */
function amountError(value: number | null, text: string, allowed: number, currency: string): string | null {
  if (!text.trim()) return 'Сколько ты перевёл?';
  if (value === null) return 'Похоже, это не сумма';
  if (value <= 0) return 'Сумма должна быть больше нуля';
  if (value > allowed) return `Это больше, чем с тебя этому человеку: не больше ${money(allowed, currency)}`;
  return null;
}

/**
 * M07 «Отметить перевод»: шит снизу на телефоне, окно по центру на компьютере.
 * Деньги приложение не переводит — должник отмечает, получатель потом подтверждает.
 */
export function SettleSheet({ g, meId, balances, settlements, request, onClose }: Props) {
  const recipients = balances.transfers.filter((t) => t.fromId === meId).map((t) => t.toId);
  const [toId, setToId] = useState(request.toId);
  const allowed = allowedTo(balances, settlements, meId, toId);
  const prefill = request.amount !== undefined && request.amount <= allowed ? request.amount : allowed;
  const [mode, setMode] = useState<Mode>(prefill === allowed ? 'all' : 'part');
  const [text, setText] = useState(() => amountToInput(prefill, g.currency as CurrencyCode));
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const mark = useMarkSettlement(g.id);
  const toast = useToast();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const value = mode === 'all' ? allowed : parseAmount(text, g.currency as CurrencyCode);
  const error = amountError(value, mode === 'all' ? String(allowed) : text, allowed, g.currency);
  const name = nameOf(g, toId);

  const pick = (id: string) => {
    setToId(id);
    setMode('all');
    setText(amountToInput(allowedTo(balances, settlements, meId, id), g.currency as CurrencyCode));
    mark.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error !== null || value === null) return;
    mark.mutate(
      { toId, amount: value, comment: comment.trim() || null },
      {
        onSuccess: () => {
          toast(`Перевод отмечен. ${name} подтвердит, когда деньги придут.`);
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} className="settle-sheet" onSubmit={submit} noValidate>
        <span className="settle-sheet__grip mobile-only" aria-hidden="true" />
        <div className="settle-sheet__head">
          <h2 id={titleId} className="settle-sheet__title">
            Перевод: {name}
          </h2>
          <button type="button" className="icon-btn settle-sheet__close" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <OweLine g={g} meId={meId} balances={balances} />
        {recipients.length > 1 && <RecipientPicker g={g} recipients={recipients} value={toId} balances={balances} meId={meId} onPick={pick} />}
        <p className="settle-sheet__intro">{fill(copy.settlement.markIntro, { name })}</p>
        <AmountField
          currency={g.currency}
          mode={mode}
          allowed={allowed}
          text={mode === 'all' ? amountToInput(allowed, g.currency as CurrencyCode) : text}
          error={touched ? error : null}
          onMode={(m) => {
            setMode(m);
            if (m === 'part') setText(amountToInput(allowed, g.currency as CurrencyCode));
          }}
          onText={(t) => {
            setMode('part');
            setText(t);
          }}
        />
        <Summary g={g} owe={transferAmount(balances, meId, toId)} pending={pendingFrom(settlements, meId, toId)} marking={error === null ? (value ?? 0) : 0} name={name} />
        <label className="field">
          <span className="field__label">Комментарий, если нужно</span>
          <input
            className="input"
            maxLength={300}
            placeholder="Например: перевёл в банке"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
          />
        </label>
        {mark.error && (
          <p className="form-error" role="alert">
            {errorText(mark.error)}
          </p>
        )}
        <div className="settle-sheet__foot">
          <button type="submit" className="btn btn--primary btn--main" disabled={mark.isPending || allowed <= 0}>
            {fill(copy.settlement.markButton, { amount: '' }).trim()}
            {error === null && value !== null && <span className="n">{moneyCur(value, g.currency)}</span>}
          </button>
          <p className="hint-sm settle-sheet__hint">{copy.settlement.notCountedYet}</p>
        </div>
      </form>
    </div>
  );
}

/** «С тебя 3 200,00 ₽» над формой: общий итог, чтобы было видно, из чего часть. */
function OweLine({ g, meId, balances }: { g: GroupDto; meId: string; balances: BalancesDto }) {
  const owe = -balanceOf(balances, meId);
  if (owe <= 0) return null;
  const parts = balances.transfers.filter((t) => t.fromId === meId).map((t) => `${nameOf(g, t.toId)} ${money(t.amount, g.currency)}`);
  return (
    <p className="settle-sheet__owe">
      {copy.balance.youOwe} <span className="n minus">{moneyCur(owe, g.currency)}</span>
      {parts.length > 1 && <span className="n"> · {parts.join(' · ')}</span>}
    </p>
  );
}

function RecipientPicker(p: { g: GroupDto; recipients: string[]; value: string; balances: BalancesDto; meId: string; onPick: (id: string) => void }) {
  return (
    <div className="settle-sheet__to" role="radiogroup" aria-label="Кому">
      {p.recipients.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={p.value === id}
          className="filter-chip"
          onClick={() => {
            p.onPick(id);
          }}
        >
          {nameOf(p.g, id)} <span className="n">{money(transferAmount(p.balances, p.meId, id), p.g.currency)}</span>
        </button>
      ))}
    </div>
  );
}

interface AmountProps {
  currency: string;
  mode: Mode;
  allowed: number;
  text: string;
  error: string | null;
  onMode: (m: Mode) => void;
  onText: (t: string) => void;
}

function AmountField(p: AmountProps) {
  const id = useId();
  return (
    <div className="settle-amount">
      <label htmlFor={id} className="field__label">
        {fill(copy.settlement.howMuch, { currency: currencySymbol(p.currency as CurrencyCode) })}
      </label>
      <input
        id={id}
        className="n settle-amount__input"
        inputMode="decimal"
        autoComplete="off"
        value={p.text}
        aria-invalid={p.error !== null}
        aria-describedby={p.error ? `${id}-err` : undefined}
        onChange={(e) => {
          p.onText(e.target.value);
        }}
      />
      {p.error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {p.error}
        </p>
      )}
      <div className="settle-amount__quick" role="group" aria-label="Быстрый выбор">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={p.mode === 'all'}
          onClick={() => {
            p.onMode('all');
          }}
        >
          Всё <span className="n">{money(p.allowed, p.currency)}</span>
        </button>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={p.mode === 'part'}
          onClick={() => {
            p.onMode('part');
          }}
        >
          {copy.settlement.part}
        </button>
      </div>
    </div>
  );
}

/** Живой итог: сколько с тебя этому человеку, сколько уже ждёт подтверждения, сколько отмечаешь и что останется. */
function Summary({ g, owe, pending, marking, name }: { g: GroupDto; owe: number; pending: number; marking: number; name: string }) {
  const left = Math.max(0, owe - pending - marking);
  return (
    <div className="settle-summary n">
      <span>{name}: с тебя сейчас</span>
      <span>{money(owe, g.currency)}</span>
      {pending > 0 && (
        <>
          <span>Уже отмечено, ждёт подтверждения</span>
          <span>− {money(pending, g.currency)}</span>
        </>
      )}
      <span>{copy.settlement.marking}</span>
      <span>− {money(marking, g.currency)}</span>
      <strong className="settle-summary__total">{copy.settlement.leftAfter}</strong>
      <strong className={`settle-summary__total${left > 0 ? ' minus' : ''}`}>{money(left, g.currency)}</strong>
    </div>
  );
}
