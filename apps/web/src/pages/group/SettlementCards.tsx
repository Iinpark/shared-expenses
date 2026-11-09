import { byGender, type BalancesDto, type GroupDto, type SettlementDto } from '@se/shared';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { copy, fill } from '../../lib/copy.js';
import { memberOf } from '../../lib/events.js';
import { money, moneyCur } from '../../lib/format.js';
import { errorText, useDecideSettlement, type SettlementDecision } from '../../lib/queries/index.js';
import { dayMonth, plural } from '../../lib/ru.js';
import { allowedTo, balanceOf, daysSince, pendingFrom, previewConfirm, readDismissed, recentlyConfirmed, rejectedToShow, transferAmount, writeDismissed } from '../../lib/settlements.js';
import type { MarkRequest } from './SettleSheet.js';

/** Всё, что нужно карточкам погашений на экране группы (S01, M02, D02). */
export interface SettleCtx {
  g: GroupDto;
  meId: string;
  balances: BalancesDto;
  settlements: SettlementDto[];
  onMark: (r: MarkRequest) => void;
  /** Своё подтверждение сейчас поменяет цифры — не подсвечивать их как чужие. */
  expectOwn: (on: boolean) => void;
}

const nameOf = (g: GroupDto, id: string) => memberOf(g, id)?.name ?? 'Бывший участник';
const genderOf = (g: GroupDto, id: string) => memberOf(g, id)?.gender ?? null;

/** Действие над погашением с ошибкой сервера под кнопками. */
function useDecide(c: SettleCtx) {
  const decide = useDecideSettlement(c.g.id);
  const toast = useToast();
  const run = (s: SettlementDto, action: SettlementDecision, done: string) => {
    if (action === 'confirm') c.expectOwn(true);
    decide.mutate(
      { id: s.id, action },
      {
        onSuccess: () => {
          toast(done);
        },
        onError: () => {
          c.expectOwn(false);
        },
      },
    );
  };
  return { run, busy: decide.isPending, error: decide.error ? errorText(decide.error) : null };
}

function Card({ kind, icon, title, children }: { kind: 'pending' | 'rejected' | 'confirmed'; icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`settle-card settle-card--${kind}`} role={kind === 'rejected' ? 'alert' : undefined}>
      <div className="settle-card__top">
        {icon}
        <div className="settle-card__text">{title}</div>
      </div>
      {children}
    </div>
  );
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;

// ---------- Получатель: «Гена отметил перевод» ----------

function IncomingCard({ c, s }: { c: SettleCtx; s: SettlementDto }) {
  const [asking, setAsking] = useState(false);
  const { run, busy, error } = useDecide(c);
  const from = nameOf(c.g, s.fromId);
  const after = transferAmount(previewConfirm(c.balances, s), s.fromId, c.meId);
  const title = (
    <>
      <p className="settle-card__title n">
        {from} {byGender(genderOf(c.g, s.fromId), 'отметил', 'отметила')} перевод {moneyCur(s.amount, c.g.currency)}
      </p>
      <p className="settle-card__sub">
        {dayMonth(s.createdAt)}. {copy.settlement.pendingIncomingHint}
      </p>
      {s.comment && <p className="settle-card__comment">«{s.comment}»</p>}
    </>
  );
  return (
    <Card kind="pending" icon={<Icon name="clock" />} title={title}>
      <div className="settle-card__line n">
        <span>Если подтвердишь, {from} вернёт ещё</span>
        <strong className="plus">{money(after, c.g.currency)}</strong>
      </div>
      {c.g.status === 'open' && !asking && (
        <div className="settle-card__btns">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              run(s, 'confirm', 'Перевод подтверждён. Баланс обновился.');
            }}
          >
            Деньги пришли
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setAsking(true);
            }}
          >
            Не пришли
          </button>
        </div>
      )}
      {asking && (
        <>
          <p className="settle-card__sub">{fill(copy.settlement.rejectHint, { name: from })}</p>
          <div className="settle-card__btns">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => {
                run(s, 'reject', `${from} увидит, что деньги не пришли.`);
              }}
            >
              Точно не пришли
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setAsking(false);
              }}
            >
              Назад
            </button>
          </div>
        </>
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

// ---------- Должник: «Ты отметил 2 000,00 → Аня» ----------

function waiting(createdAt: string): string {
  const days = daysSince(createdAt);
  return days === 0 ? 'ждёт подтверждения' : `ждёт подтверждения ${String(days)} ${plural(days, 'день', 'дня', 'дней')}`;
}

function OutgoingCard({ c, s }: { c: SettleCtx; s: SettlementDto }) {
  const { run, busy, error } = useDecide(c);
  const to = nameOf(c.g, s.toId);
  const after = balanceOf(c.balances, c.meId) + s.amount;
  const title = (
    <>
      <p className="settle-card__title n">
        Ты {byGender(genderOf(c.g, c.meId), 'отметил', 'отметила')} {money(s.amount, c.g.currency)} → {to}
      </p>
      <p className="settle-card__sub">
        {dayMonth(s.createdAt)} · {waiting(s.createdAt)}. Сумма уменьшится, когда {to} подтвердит.
      </p>
    </>
  );
  return (
    <Card kind="pending" icon={<Icon name="clock" />} title={title}>
      <div className="settle-card__line n">
        <span>После подтверждения</span>
        {after < 0 ? <strong className="minus">{money(-after, c.g.currency)}</strong> : <strong>в расчёте</strong>}
      </div>
      {c.g.status === 'open' && (
        <button
          type="button"
          className="btn settle-card__wide"
          disabled={busy}
          onClick={() => {
            run(s, 'cancel', 'Отметка отменена.');
          }}
        >
          {copy.settlement.cancelMark}
        </button>
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

// ---------- Должник: отклонено и подтверждено ----------

function RejectedCard({ c, s, onDismiss }: { c: SettleCtx; s: SettlementDto; onDismiss: () => void }) {
  const to = nameOf(c.g, s.toId);
  const title = (
    <>
      <p className="settle-card__title n">
        {copy.fun.rejectedPrefix} {to} {byGender(genderOf(c.g, s.toId), 'не получил', 'не получила')} <s className="struck">{money(s.amount, c.g.currency)}</s>
      </p>
      <p className="settle-card__sub">
        {dayMonth(s.decidedAt ?? s.createdAt)}. {copy.settlement.rejectedHint}
      </p>
    </>
  );
  return (
    <Card kind="rejected" icon={<Icon name="rejected" />} title={title}>
      <div className="settle-card__btns">
        {c.g.status === 'open' && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              c.onMark({ toId: s.toId, amount: s.amount });
            }}
          >
            {copy.settlement.markAgain}
          </button>
        )}
        <button type="button" className="btn" onClick={onDismiss}>
          Понятно
        </button>
      </div>
    </Card>
  );
}

function ConfirmedCard({ c, s }: { c: SettleCtx; s: SettlementDto }) {
  const to = nameOf(c.g, s.toId);
  const title = (
    <>
      <p className="settle-card__title n">
        {to} {byGender(genderOf(c.g, s.toId), 'подтвердил', 'подтвердила')} {money(s.amount, c.g.currency)}
      </p>
      <p className="settle-card__sub">
        {dayMonth(s.decidedAt ?? s.createdAt)} · {copy.settlement.confirmedHint}
      </p>
    </>
  );
  const icon = (
    <span className="settle-card__done" aria-hidden="true">
      <Icon name="check" size={14} strokeWidth={2.6} />
    </span>
  );
  return <Card kind="confirmed" icon={icon} title={title} />;
}

/** «Осталось отметить»: кому ещё можно отметить перевод и сколько, с кнопкой «Отметить». */
function LeftToMark({ c }: { c: SettleCtx }) {
  const rows = c.balances.transfers
    .filter((t) => t.fromId === c.meId)
    .map((t) => ({ toId: t.toId, left: allowedTo(c.balances, c.settlements, c.meId, t.toId) }))
    .filter((r) => r.left > 0);
  if (rows.length === 0 || c.g.status !== 'open') return null;
  return (
    <div className="settle-left">
      <h3 className="settle-left__title">Осталось отметить</h3>
      <div className="settle-left__list">
        {rows.map((r) => (
          <div key={r.toId} className="settle-left__row n">
            <span>{nameOf(c.g, r.toId)}</span>
            <span className="settle-left__side">
              <strong>{money(r.left, c.g.currency)}</strong>
              <button
                type="button"
                className="btn btn--primary btn--xs"
                onClick={() => {
                  c.onMark({ toId: r.toId });
                }}
              >
                Отметить
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Нажатые «Понятно»: помним на устройстве, чтобы отклонённая карточка не возвращалась. */
function useDismissed() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    writeDismissed(next);
    setDismissed(next);
  };
  return { dismissed, dismiss };
}

/**
 * Погашения под балансом (M02, D02 — в правой панели под героем): что ждёт тебя, что ждёт других,
 * что отклонили и что недавно подтвердили. Ожидающие в баланс не входят — карточки стоят рядом с ним.
 */
export function SettlementCards({ c }: { c: SettleCtx }) {
  const { dismissed, dismiss } = useDismissed();
  const pending = c.settlements.filter((s) => s.status === 'pending');
  const incoming = pending.filter((s) => s.toId === c.meId);
  const outgoing = pending.filter((s) => s.fromId === c.meId);
  const rejected = rejectedToShow(c.settlements, c.meId, dismissed);
  const confirmed = recentlyConfirmed(c.settlements, c.meId);
  if (incoming.length + outgoing.length + rejected.length + confirmed.length === 0) return null;
  return (
    <section className="settle-cards" aria-label="Погашения">
      {incoming.map((s) => (
        <IncomingCard key={s.id} c={c} s={s} />
      ))}
      {rejected.map((s) => (
        <RejectedCard
          key={s.id}
          c={c}
          s={s}
          onDismiss={() => {
            dismiss(s.id);
          }}
        />
      ))}
      {outgoing.map((s) => (
        <OutgoingCard key={s.id} c={c} s={s} />
      ))}
      {confirmed.map((s) => (
        <ConfirmedCard key={s.id} c={c} s={s} />
      ))}
      {outgoing.length > 0 && <LeftToMark c={c} />}
    </section>
  );
}

/** Есть ли у тебя отмеченные и не подтверждённые переводы — тогда «Отметить» живёт в блоке «Осталось отметить». */
export const hasOutgoingPending = (c: Pick<SettleCtx, 'settlements' | 'meId'>) => pendingFrom(c.settlements, c.meId) > 0;
