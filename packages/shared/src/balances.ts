/**
 * Балансы и переводы.
 *
 * Баланс участника — сколько он заплатил за всех минус сколько составляют его доли
 * (плюс подтверждённые погашения — появятся на этапе погашений). Плюс — ему вернут, минус — с него.
 * Балансы не хранятся, а каждый раз считаются из расходов, поэтому правка старого расхода
 * сама пересчитывает всё.
 */

export interface LedgerExpense {
  payerId: string;
  amount: number;
  shares: { userId: string; amount: number }[];
}

/** Подтверждённое погашение: from отдал to деньги. */
export interface LedgerSettlement {
  fromId: string;
  toId: string;
  amount: number;
}

export interface Balance {
  userId: string;
  amount: number;
}

export interface Transfer {
  fromId: string;
  toId: string;
  amount: number;
}

/** Как один расход меняет балансы: плательщику +сумма, каждому участнику −его доля. */
export function expenseEffect(expense: LedgerExpense): Map<string, number> {
  const delta = new Map<string, number>();
  const add = (id: string, v: number) => delta.set(id, (delta.get(id) ?? 0) + v);
  add(expense.payerId, expense.amount);
  for (const s of expense.shares) add(s.userId, -s.amount);
  return delta;
}

/**
 * Балансы всех участников в порядке memberIds (порядок вступления).
 * Сумма балансов всегда 0: каждый расход раскладывается на доли без остатка.
 */
export function computeBalances(memberIds: string[], expenses: LedgerExpense[], settlements: LedgerSettlement[] = []): Balance[] {
  const total = new Map<string, number>(memberIds.map((id) => [id, 0]));
  const add = (id: string, v: number) => total.set(id, (total.get(id) ?? 0) + v);
  for (const e of expenses) for (const [id, v] of expenseEffect(e)) add(id, v);
  // Отдал деньги — с тебя стало меньше; получил — тебе должны меньше.
  for (const s of settlements) {
    add(s.fromId, s.amount);
    add(s.toId, -s.amount);
  }
  return [...total].map(([userId, amount]) => ({ userId, amount }));
}

/** Сколько переводов понадобилось бы, если бы каждый рассчитывался с каждым: n·(n−1)/2. */
export const naiveTransferCount = (people: number) => (people * (people - 1)) / 2;

/** До скольких людей с ненулевым балансом ищем точный минимум переводов (решение 5 в DECISIONS). */
export const EXACT_TRANSFERS_LIMIT = 15;

/**
 * Жадное сведение: самый большой должник платит самому большому кредитору, пока все не обнулятся.
 * При равенстве сумм раньше идёт тот, кто раньше в списке (порядок вступления), — результат детерминирован.
 */
function greedy(people: Balance[]): Transfer[] {
  const left = people.map((p) => ({ ...p }));
  const out: Transfer[] = [];
  for (;;) {
    let debtor: (typeof left)[number] | undefined;
    let creditor: (typeof left)[number] | undefined;
    for (const p of left) {
      if (p.amount < 0 && (!debtor || p.amount < debtor.amount)) debtor = p;
      if (p.amount > 0 && (!creditor || p.amount > creditor.amount)) creditor = p;
    }
    if (!debtor || !creditor) return out;
    const amount = Math.min(-debtor.amount, creditor.amount);
    out.push({ fromId: debtor.userId, toId: creditor.userId, amount });
    debtor.amount += amount;
    creditor.amount -= amount;
  }
}

/**
 * Разбивает людей на как можно больше компаний, внутри которых балансы в сумме дают ноль.
 * Каждая такая компания рассчитывается внутри себя за (её размер − 1) переводов, поэтому
 * чем больше компаний, тем меньше переводов всего. Перебор всех подмножеств: 2^n вариантов,
 * для 15 человек это ~33 тысячи — мгновенно.
 */
function zeroSumGroups(people: Balance[]): Balance[][] {
  const n = people.length;
  const full = (1 << n) - 1;
  const sum = new Array<number>(1 << n).fill(0);
  const best = new Array<number>(1 << n).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low]! + people[31 - Math.clz32(low)]!.amount;
    let b = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) b = Math.max(b, best[mask ^ (1 << i)]!);
    best[mask] = b + (sum[mask] === 0 ? 1 : 0);
  }
  // Восстанавливаем разбиение: идём от всех людей к пустому множеству по лучшему пути.
  // Наборы с нулевой суммой на этом пути вложены друг в друга; их разности и есть компании.
  const groups: Balance[][] = [];
  let mask = full;
  let zeroMask = full;
  while (mask) {
    let next = -1;
    for (let i = 0; i < n && next < 0; i++) {
      const m = mask ^ (1 << i);
      if (mask & (1 << i) && best[m]! + (sum[mask] === 0 ? 1 : 0) === best[mask]) next = m;
    }
    mask = next;
    if (sum[mask] === 0) {
      const diff = zeroMask ^ mask;
      groups.push(people.filter((_, i) => diff & (1 << i)));
      zeroMask = mask;
    }
  }
  return groups;
}

/**
 * Минимальный набор переводов, после которого все в расчёте.
 * До EXACT_TRANSFERS_LIMIT людей с ненулевым балансом — точный минимум, для больших групп — жадно
 * (не больше n−1 переводов, но иногда на один-два больше минимума).
 * Сортировка: сначала переводы того, с кого больше всего, внутри — крупные первыми.
 */
export function minimalTransfers(balances: Balance[]): Transfer[] {
  const people = balances.filter((b) => b.amount !== 0);
  const transfers = people.length > EXACT_TRANSFERS_LIMIT ? greedy(people) : zeroSumGroups(people).flatMap((group) => greedy(group));
  // Порядок для показа: сначала все переводы самого большого должника, внутри — крупные первыми.
  const debt = new Map(people.map((p) => [p.userId, p.amount]));
  return transfers.sort((a, b) => debt.get(a.fromId)! - debt.get(b.fromId)! || b.amount - a.amount);
}
