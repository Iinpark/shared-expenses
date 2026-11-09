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

type Person = Balance;

/** Самый большой должник и самый большой кредитор; при равенстве — кто раньше в списке. */
function extremes(left: Person[]): { debtor?: Person; creditor?: Person } {
  let debtor: Person | undefined;
  let creditor: Person | undefined;
  for (const p of left) {
    if (p.amount < (debtor?.amount ?? 0)) debtor = p;
    if (p.amount > (creditor?.amount ?? 0)) creditor = p;
  }
  return { debtor, creditor };
}

/**
 * Жадное сведение: самый большой должник платит самому большому кредитору, пока все не обнулятся.
 * При равенстве сумм раньше идёт тот, кто раньше в списке (порядок вступления), — результат детерминирован.
 */
function greedy(people: Person[]): Transfer[] {
  const left = people.map((p) => ({ ...p }));
  const out: Transfer[] = [];
  for (let { debtor, creditor } = extremes(left); debtor && creditor; { debtor, creditor } = extremes(left)) {
    const amount = Math.min(-debtor.amount, creditor.amount);
    out.push({ fromId: debtor.userId, toId: creditor.userId, amount });
    debtor.amount += amount;
    creditor.amount -= amount;
  }
  return out;
}

const bit = (i: number) => 1 << i;
const has = (mask: number, i: number) => (mask & bit(i)) !== 0;
/** Элемент массива, который точно есть (индекс в пределах): для типизированных массивов перебора. */
const at = (arr: Float64Array, i: number) => arr[i] ?? 0;

/**
 * Для каждого набора людей (маски) — сумма их балансов и наибольшее число компаний с нулевой суммой,
 * на которые этот набор можно разбить по цепочке «убирать по одному человеку».
 */
function subsetTables(people: Person[]) {
  const n = people.length;
  const size = bit(n);
  const sum = new Float64Array(size);
  const best = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sum[mask] = at(sum, mask ^ low) + (people[31 - Math.clz32(low)]?.amount ?? 0);
    let b = 0;
    for (let i = 0; i < n; i++) if (has(mask, i)) b = Math.max(b, at(best, mask ^ bit(i)));
    best[mask] = b + (at(sum, mask) === 0 ? 1 : 0);
  }
  return { sum, best };
}

/** Следующий шаг лучшего пути: кого убрать из набора, чтобы не потерять ни одной компании. */
function nextOnBestPath(mask: number, n: number, sum: Float64Array, best: Float64Array): number {
  const bonus = at(sum, mask) === 0 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const m = mask ^ bit(i);
    if (has(mask, i) && at(best, m) + bonus === at(best, mask)) return m;
  }
  throw new Error('Перебор переводов: не нашли следующий шаг');
}

/**
 * Разбивает людей на как можно больше компаний, внутри которых балансы в сумме дают ноль.
 * Каждая такая компания рассчитывается внутри себя за (её размер − 1) переводов, поэтому
 * чем больше компаний, тем меньше переводов всего. Перебор всех подмножеств: 2^n вариантов,
 * для 15 человек это ~33 тысячи — мгновенно.
 */
function zeroSumGroups(people: Person[]): Person[][] {
  const n = people.length;
  const { sum, best } = subsetTables(people);
  // Восстанавливаем разбиение: идём от всех людей к пустому множеству по лучшему пути.
  // Наборы с нулевой суммой на этом пути вложены друг в друга; их разности и есть компании.
  const groups: Person[][] = [];
  let zeroMask = bit(n) - 1;
  for (let mask = zeroMask; mask !== 0; ) {
    mask = nextOnBestPath(mask, n, sum, best);
    if (at(sum, mask) === 0) {
      const diff = zeroMask ^ mask;
      groups.push(people.filter((_, i) => has(diff, i)));
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
  const debtOf = (id: string) => debt.get(id) ?? 0;
  return transfers.sort((a, b) => debtOf(a.fromId) - debtOf(b.fromId) || b.amount - a.amount);
}
