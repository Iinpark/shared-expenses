import { currencySymbol, type BalancesDto, type CurrencyCode, type GroupDto, type SettlementDto } from '@se/shared';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { copy } from '../../lib/copy.js';
import { memberOf } from '../../lib/events.js';
import { money } from '../../lib/format.js';
import { errorText, useBalances, useCloseGroup, useSettlements } from '../../lib/queries/index.js';
import { plural } from '../../lib/ru.js';

const settlementsWord = (n: number) => `${String(n)} ${plural(n, 'погашение', 'погашения', 'погашений')}`;
const waitVerb = (n: number) => plural(n, 'ждёт', 'ждут', 'ждут');

/** Пункты «Ещё не все в расчёте»: оставшиеся переводы и ожидающие погашения (сначала те, что ждут тебя). */
function notSettledItems(g: GroupDto, meId: string, balances: BalancesDto, settlements: SettlementDto[]): string[] {
  const items: string[] = [];
  const left = balances.transfers;
  if (left.length > 0) {
    const sum = left.reduce((acc, t) => acc + t.amount, 0);
    items.push(`${String(left.length)} ${plural(left.length, 'перевод', 'перевода', 'переводов')} на ${money(sum, g.currency)} ${currencySymbol(g.currency as CurrencyCode)}`);
  }
  const pending = settlements.filter((s) => s.status === 'pending');
  const forMe = pending.filter((s) => s.toId === meId);
  if (forMe.length > 0) {
    const who = forMe.map((s) => `${memberOf(g, s.fromId)?.name ?? 'бывший участник'}, ${money(s.amount, g.currency)}`).join('; ');
    items.push(`${settlementsWord(forMe.length)} ${waitVerb(forMe.length)} тебя: ${who}`);
  }
  const others = pending.length - forMe.length;
  if (others > 0) items.push(`${settlementsWord(others)} ${waitVerb(others)} подтверждения`);
  return items;
}

/** «Всем 4 участникам уйдёт письмо…»; если в группе только ты — письмо придёт тебе. */
const whoGetsMail = (n: number) => (n === 1 ? 'Тебе' : `Всем ${String(n)} ${plural(n, 'участнику', 'участникам', 'участникам')}`);

/** D04: подтверждение закрытия группы. Закрыть можно и с остатками — они попадут в итог. */
export function ClosePanel({ g, meId, onCancel }: { g: GroupDto; meId: string; onCancel: () => void }) {
  const balances = useBalances(g.id);
  const settlements = useSettlements(g.id);
  const close = useCloseGroup(g.id);
  const toast = useToast();
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // На телефоне панель появляется под списком участников: показываем её.
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const items = balances.data && settlements.data ? notSettledItems(g, meId, balances.data, settlements.data) : [];
  // mutateAsync, а не колбэки mutate: панель исчезает, как только в кэше окажется закрытая группа,
  // а колбэки mutate у размонтированного компонента не вызываются.
  const run = () => {
    close.mutateAsync().then(
      () => {
        toast('Группа закрыта, итог ушёл письмом');
        void navigate(`/groups/${g.id}/report`);
      },
      () => undefined,
    );
  };

  return (
    <section ref={ref} aria-labelledby="close-title" className="close-panel">
      <h2 id="close-title" className="close-panel__title">
        {copy.group.closeTitle}
      </h2>
      <p className="close-panel__text">{copy.group.closeText}</p>
      {items.length > 0 && (
        <div className="warn close-panel__warn">
          <p className="close-panel__warn-title">{copy.group.closeNotSettled}</p>
          <ul className="close-panel__list">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p>Закрыть можно и так: остатки попадут в итог. Чтобы потом отметить погашение, группу придётся открыть снова.</p>
        </div>
      )}
      <div className="close-panel__what">
        <span style={{ fontWeight: 600 }}>Что произойдёт</span>
        <span className="text-2">{whoGetsMail(g.memberCount)} уйдёт письмо с итогом и ссылкой на отчёт.</span>
      </div>
      {close.error && (
        <p className="form-error" role="alert">
          {errorText(close.error)}
        </p>
      )}
      <div className="close-panel__btns">
        <button type="button" className="btn btn--primary" disabled={close.isPending} onClick={run}>
          <Icon name="lock" size={18} />
          {copy.group.closeConfirm}
        </button>
        <button type="button" className="btn" disabled={close.isPending} onClick={onCancel}>
          Не сейчас
        </button>
      </div>
    </section>
  );
}
