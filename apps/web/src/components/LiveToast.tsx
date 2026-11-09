import { currencySymbol, type CurrencyCode, type GroupDto, type GroupEventDto } from '@se/shared';
import { copy, fill } from '../lib/copy.js';
import { actorGender, balanceDeltas, expenseVerb, involves, isExpenseEvent, latest, moneyShort, snapshots, snapshotTitle, type ExpensePayload } from '../lib/events.js';
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
 * LiveToast на любом экране: о чужих расходах, в которых ты платил или участвуешь
 * (ТЗ: «участник получает уведомление, когда появился расход с его участием или такой расход отредактировали»).
 */
export function LiveToastListener() {
  const me = useCurrentUser();
  const toast = useToast();
  const lookup = useGroupLookup();
  useGroupEventListener((event) => {
    const p = event.payload;
    if (event.actorId === me.id || !isExpenseEvent(p) || !involves(p, me.id)) return;
    lookup(event.groupId).then(
      (g) => {
        toast(liveToast(event, p, g, me.id));
      },
      () => undefined,
    );
  });
  return null;
}
