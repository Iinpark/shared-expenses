import type { CurrencyCode, GroupDto, MemberDto, ShareResult } from '@se/shared';
import { copy } from '../../lib/copy.js';
import { money } from '../../lib/format.js';
import type { Draft } from './draft.js';
import { Reconcile } from './Reconcile.js';

/** «Как делим»: переключатель способа, строки участников и сверка с суммой (M04–M06). */
export function SplitSection({ d, g, meId }: { d: Draft; g: GroupDto; meId: string }) {
  return (
    <>
      <span className="field__label--strong" style={{ fontWeight: 600, fontSize: 16 }}>
        {copy.expense.splitTitle}
      </span>
      <div className="segments" role="radiogroup" aria-label={copy.expense.splitTitle}>
        {(['equal', 'shares', 'exact'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={d.mode === m}
            onClick={() => {
              d.setMode(m);
            }}
          >
            {copy.expense.splitModes[m]}
          </button>
        ))}
      </div>
      <div className="split-list">
        {g.members.map((m) => (
          <SplitRow key={m.userId} d={d} member={m} isMe={m.userId === meId} />
        ))}
      </div>
      <Reconcile d={d} g={g} meId={meId} />
    </>
  );
}

function SplitRow({ d, member: m, isMe }: { d: Draft; member: MemberDto; isMe: boolean }) {
  const label = isMe ? `${m.name} (ты)` : m.name;
  const share = d.shares?.find((s) => s.userId === m.userId);
  switch (d.mode) {
    case 'equal':
      return <EqualRow label={label} on={d.selected.has(m.userId)} share={share} currency={d.currency} onToggle={() => { d.toggle(m.userId); }} />;
    case 'shares':
      return <SharesRow label={label} name={m.name} isMe={isMe} weight={d.weights[m.userId] ?? 0} share={share} currency={d.currency} onChange={(v) => { d.setWeight(m.userId, v); }} />;
    case 'exact':
      return <ExactRow label={label} name={m.name} value={d.exact[m.userId] ?? ''} onChange={(v) => { d.setExactFor(m.userId, v); }} />;
  }
}

/** «+1 коп.» рядом с тем, кому досталась лишняя копейка. */
function extraLabel(currency: CurrencyCode): string {
  if (currency === 'RUB') return '+1 коп.';
  if (currency === 'KZT') return '+1 тиын';
  return `+${money(1, currency)}`;
}

const shareText = (share: ShareResult | undefined, currency: CurrencyCode) => (share ? money(share.amount, currency) : '—');

function EqualRow(p: { label: string; on: boolean; share: ShareResult | undefined; currency: CurrencyCode; onToggle: () => void }) {
  return (
    <label className={`split-row${p.on ? '' : ' split-row--off'}`}>
      <span className="split-row__name">
        <input type="checkbox" checked={p.on} onChange={p.onToggle} />
        <span>
          {p.label} {p.on && p.share?.extra && <span className="extra-cent">{extraLabel(p.currency)}</span>}
        </span>
      </span>
      {p.on ? <span className="n split-row__amount">{shareText(p.share, p.currency)}</span> : <span className="hint-sm">{copy.expense.notParticipating}</span>}
    </label>
  );
}

function SharesRow(p: { label: string; name: string; isMe: boolean; weight: number; share: ShareResult | undefined; currency: CurrencyCode; onChange: (v: number) => void }) {
  const w = p.weight;
  return (
    <div className={`split-row${w ? '' : ' split-row--off'}`}>
      <span className="split-row__name" style={p.isMe ? { fontWeight: 600 } : undefined}>
        {p.label}
      </span>
      <span className={`stepper${p.isMe ? ' stepper--me' : ''}`}>
        <button
          type="button"
          aria-label={`Меньше долей: ${p.name}`}
          onClick={() => {
            p.onChange(w - 1);
          }}
          disabled={w === 0}
        >
          −
        </button>
        <span className="n" aria-label={`Долей: ${String(w)}`}>
          {w}
        </span>
        <button
          type="button"
          aria-label={`Больше долей: ${p.name}`}
          onClick={() => {
            p.onChange(w + 1);
          }}
        >
          +
        </button>
      </span>
      <span className="n split-row__amount" style={{ minWidth: 88, textAlign: 'right' }}>
        {w ? shareText(p.share, p.currency) : '—'}
      </span>
    </div>
  );
}

function ExactRow(p: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="split-row">
      <span className="split-row__name">{p.label}</span>
      <input
        className="exact-input"
        inputMode="decimal"
        placeholder="0"
        value={p.value}
        aria-label={`Сумма: ${p.name}`}
        onChange={(e) => {
          p.onChange(e.target.value);
        }}
      />
    </label>
  );
}
