import { byGender, currencySymbol, type CurrencyCode, type GroupDto, type GroupEventDto } from '@se/shared';
import { copy, fill } from '../lib/copy.js';
import {
  actorGender,
  balanceDeltas,
  expenseVerb,
  involves,
  isExpenseEvent,
  isSettlementEvent,
  latest,
  moneyShort,
  settlementPath,
  snapshots,
  snapshotTitle,
  type ExpensePayload,
  type SettlementPayload,
} from '../lib/events.js';
import { money } from '../lib/format.js';
import { useCurrentUser, useGroupEventListener, useGroupLookup } from '../lib/queries/index.js';
import { joinNames } from '../lib/ru.js';
import { useToast, type ToastContent } from './Toast.js';

/** Первая строка: «Борис изменил «Такси»: 1 000 → 1 200 ₽». */
function headline(p: ExpensePayload, actor: string, g: GroupDto, verb: string): string {
  const { before, after } = snapshots(p);
  const sym = currencySymbol(g.currency as CurrencyCode);
  const head = `${actor} ${verb} «${snapshotTitle(latest(p))}»`;
  if (!before && after) return `${head} на ${moneyShort(after.amount, g.currency)} ${sym}`;
  if (before && after && before.amount !== after.amount) {
    return `${head}: ${moneyShort(before.amount, g.currency)} → ${moneyShort(after.amount, g.currency)} ${sym}`;
  }
  return head;
}

/** Вторая строка: кого пересчитали и что с твоим балансом. */
function recalcLine(p: ExpensePayload, g: GroupDto, meId: string): string {
  const deltas = balanceDeltas(p);
  const mine = deltas.get(meId) ?? 0;
  // В порядке вступления, как в списке балансов.
  const others = g.members.filter((m) => m.userId !== meId && (deltas.get(m.userId) ?? 0) !== 0).map((m) => m.name);
  if (mine === 0) return others.length ? fill(copy.live.toastRecalc, { names: joinNames(others) }) : 'Твой баланс не изменился.';
  const change = `Твой баланс изменился на ${money(mine, g.currency, true)} ${currencySymbol(g.currency as CurrencyCode)}.`;
  return others.length ? `Пересчитаны ${joinNames(others)}. ${change}` : change;
}

function liveToast(event: GroupEventDto, p: ExpensePayload, g: GroupDto, meId: string): ToastContent {
  return {
    text: headline(p, event.actorName, g, expenseVerb(p.type, actorGender(g, event))),
    sub: recalcLine(p, g, meId),
    action: { label: copy.live.toFeed, to: `/groups/${event.groupId}/feed` },
  };
}

/**
 * Тост о погашении, которое касается тебя: получателю — о новой отметке и отмене, должнику — о решении.
 * null — событие не для тебя (или ты сам его сделал).
 */
function settlementToast(event: GroupEventDto, p: SettlementPayload, g: GroupDto, meId: string): ToastContent | null {
  const { settlement: s } = p;
  const sum = `${moneyShort(s.amount, g.currency)} ${currencySymbol(g.currency as CurrencyCode)}`;
  const gender = actorGender(g, event);
  const verb = (m: string, f: string) => `${event.actorName} ${byGender(gender, m, f)}`;
  const toGroup = { label: 'Посмотреть', to: `/groups/${g.id}` };
  const forMe = s.toId === meId;
  const mine = s.fromId === meId;
  switch (p.type) {
    case 'settlement_created':
      return forMe ? { text: `${verb('отметил', 'отметила')} перевод ${sum}`, sub: 'Подтверди, когда деньги придут.', action: { label: 'Посмотреть', to: settlementPath(g.id, s.id) } } : null;
    case 'settlement_cancelled':
      return forMe ? { text: `${verb('отменил', 'отменила')} отметку о переводе ${sum}`, sub: 'В балансе ничего не меняется.', action: toGroup } : null;
    case 'settlement_confirmed':
      return mine ? { text: `${verb('подтвердил', 'подтвердила')} ${sum}`, sub: 'Учтено в балансе.', action: toGroup } : null;
    case 'settlement_rejected':
      return mine ? { text: `${verb('отметил', 'отметила')}, что деньги не пришли`, sub: `${sum} не учтены. Проверь перевод в банке.`, action: toGroup } : null;
  }
}

/** Тост для события: о расходе с твоим участием или о погашении, где ты отдаёшь или получаешь. */
function toastFor(event: GroupEventDto, g: GroupDto, meId: string): ToastContent | null {
  const p = event.payload;
  if (isExpenseEvent(p)) return involves(p, meId) ? liveToast(event, p, g, meId) : null;
  if (isSettlementEvent(p)) return settlementToast(event, p, g, meId);
  return null;
}

/**
 * LiveToast на любом экране: о чужих расходах, в которых ты платил или участвуешь
 * (ТЗ: «участник получает уведомление, когда появился расход с его участием или такой расход отредактировали»),
 * и о чужих действиях с погашениями, где ты отдаёшь или получаешь.
 */
export function LiveToastListener() {
  const me = useCurrentUser();
  const toast = useToast();
  const lookup = useGroupLookup();
  useGroupEventListener((event) => {
    const p = event.payload;
    if (event.actorId === me.id || !(isExpenseEvent(p) || isSettlementEvent(p))) return;
    lookup(event.groupId).then(
      (g) => {
        const content = toastFor(event, g, me.id);
        if (content) toast(content);
      },
      () => undefined,
    );
  });
  return null;
}
