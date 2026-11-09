/** Погашения: кто что отметил, что покажем должнику и получателю, каким станет баланс. Без запросов к API. */
import { minimalTransfers, type BalancesDto, type SettlementDto } from '@se/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Подтверждённое погашение должник видит отдельной плашкой столько дней (S01 «Подтверждено»). */
const CONFIRMED_SHOWN_DAYS = 3;

export const balanceOf = (balances: BalancesDto, userId: string) => balances.balances.find((b) => b.userId === userId)?.amount ?? 0;

/** Сколько по переводам «Чтобы рассчитаться» from должен отдать to. */
export const transferAmount = (balances: BalancesDto, fromId: string, toId: string) =>
  balances.transfers.find((t) => t.fromId === fromId && t.toId === toId)?.amount ?? 0;

const pending = (list: SettlementDto[]) => list.filter((s) => s.status === 'pending');

/** Отмечено должником и ещё не решено: всего или только для одного получателя. */
export function pendingFrom(list: SettlementDto[], fromId: string, toId?: string): number {
  return pending(list)
    .filter((s) => s.fromId === fromId && (toId === undefined || s.toId === toId))
    .reduce((sum, s) => sum + s.amount, 0);
}

/**
 * Сколько ещё можно отметить этому получателю: перевод ему минус уже отмеченное,
 * но не больше серверного правила «с тебя сейчас минус всё отмеченное».
 */
export function allowedTo(balances: BalancesDto, list: SettlementDto[], meId: string, toId: string): number {
  const byTransfer = transferAmount(balances, meId, toId) - pendingFrom(list, meId, toId);
  const byServer = -balanceOf(balances, meId) - pendingFrom(list, meId);
  return Math.max(0, Math.min(byTransfer, byServer));
}

/** Балансы и переводы, если подтвердить погашение (M08 «Если подтвердишь», PendingCard). */
export function previewConfirm(balances: BalancesDto, s: Pick<SettlementDto, 'fromId' | 'toId' | 'amount'>): BalancesDto {
  const next = balances.balances.map((b) => {
    if (b.userId === s.fromId) return { ...b, amount: b.amount + s.amount };
    if (b.userId === s.toId) return { ...b, amount: b.amount - s.amount };
    return b;
  });
  return { ...balances, balances: next, transfers: minimalTransfers(next) };
}

/** Целых дней с момента iso: «ждёт подтверждения 2 дня». */
export const daysSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));

// ---------- Что показать должнику ----------

const byNewest = (at: (s: SettlementDto) => string) => (a: SettlementDto, b: SettlementDto) => at(b).localeCompare(at(a));
const decided = (s: SettlementDto) => s.decidedAt ?? s.createdAt;

/** Последнее решение по каждому получателю, без повторов (самое свежее по времени решения). */
function latestPerRecipient(list: SettlementDto[]): SettlementDto[] {
  const seen = new Set<string>();
  return [...list].sort(byNewest(decided)).filter((s) => {
    if (seen.has(s.toId)) return false;
    seen.add(s.toId);
    return true;
  });
}

/**
 * Отклонённые, о которых должник ещё должен узнать (S01 «Отклонено»): по каждому получателю — последнее
 * отклонение, если после него ничего заново не отмечали и человек не нажал «Понятно».
 */
export function rejectedToShow(list: SettlementDto[], meId: string, dismissed: ReadonlySet<string>): SettlementDto[] {
  const mine = list.filter((s) => s.fromId === meId);
  const rejected = latestPerRecipient(mine.filter((s) => s.status === 'rejected'));
  return rejected.filter((r) => !dismissed.has(r.id) && !mine.some((s) => s.toId === r.toId && s.createdAt > decided(r)));
}

/** Недавно подтверждённые получателями погашения должника (S01 «Подтверждено»). */
export function recentlyConfirmed(list: SettlementDto[], meId: string, now = Date.now()): SettlementDto[] {
  const fresh = list.filter((s) => s.fromId === meId && s.status === 'confirmed' && now - new Date(decided(s)).getTime() < CONFIRMED_SHOWN_DAYS * DAY_MS);
  return latestPerRecipient(fresh);
}

// ---------- «Понятно» на отклонённом: помним на этом устройстве ----------

const DISMISSED_KEY = 'se:settlements-dismissed';
const DISMISSED_LIMIT = 200;

export function readDismissed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeDismissed(ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-DISMISSED_LIMIT)));
  } catch {
    // Без хранилища карточка вернётся при следующем открытии — не страшно.
  }
}
