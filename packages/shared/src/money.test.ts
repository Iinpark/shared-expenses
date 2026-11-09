import { describe, expect, it } from 'vitest';
import {
  computeBalances,
  computeShares,
  expenseEffect,
  must,
  minimalTransfers,
  naiveTransferCount,
  type Balance,
  type LedgerExpense,
} from './index.js';
import { amountToInput, formatAmount, parseAmount } from './money.js';
import {
  KAZAN_BALANCES_AFTER_EXPENSES,
  KAZAN_BALANCES_AFTER_FIX,
  KAZAN_BORIS_SETTLEMENT,
  KAZAN_EXPENSES,
  KAZAN_MEMBERS,
  KAZAN_TAXI_FIXED_AMOUNT,
  KAZAN_TRANSFERS_AFTER_FIX,
} from './fixtures/kazan.js';

const order = (ids: readonly string[]) => new Map(ids.map((id, i) => [id, i + 1]));
const kazanOrder = order(KAZAN_MEMBERS);
const amounts = (shares: { amount: number }[]) => shares.map((s) => s.amount);
const asRecord = (balances: Balance[]) => Object.fromEntries(balances.map((b) => [b.userId, b.amount]));

describe('деление поровну', () => {
  it('1 000,00 на троих: лишняя копейка первому по порядку вступления', () => {
    const shares = computeShares(100_000, { mode: 'equal', userIds: ['b', 'c', 'a'] }, order(['a', 'b', 'c']));
    expect(shares.map((s) => [s.userId, s.amount, s.extra])).toEqual([
      ['a', 33_334, true],
      ['b', 33_333, false],
      ['c', 33_333, false],
    ]);
  });

  it('остаток раздаётся по одной копейке, а не целиком одному', () => {
    expect(amounts(computeShares(100, { mode: 'equal', userIds: ['a', 'b', 'c', 'd', 'e', 'f'] }, order('abcdef'.split(''))))).toEqual([
      17, 17, 17, 17, 16, 16,
    ]);
  });

  it('порядок в запросе не важен, важен порядок вступления', () => {
    const o = order(['x', 'y', 'z']);
    const one = computeShares(1001, { mode: 'equal', userIds: ['z', 'y', 'x'] }, o);
    const two = computeShares(1001, { mode: 'equal', userIds: ['x', 'z', 'y'] }, o);
    expect(one).toEqual(two);
  });

  it('копейка на троих: одному копейка, двум ноль', () => {
    expect(amounts(computeShares(1, { mode: 'equal', userIds: ['a', 'b', 'c'] }, order(['a', 'b', 'c'])))).toEqual([1, 0, 0]);
  });

  it('сумма долей всегда равна расходу', () => {
    for (let total = 1; total < 2000; total += 37) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        const shares = computeShares(total, { mode: 'equal', userIds: ids }, order(ids));
        expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(total);
      }
    }
  });
});

describe('деление долями', () => {
  it('2 000,00 при 1:1:1:2 → 400 · 400 · 400 · 800', () => {
    expect(amounts(computeShares(200_000, must(KAZAN_EXPENSES[3]).split, kazanOrder))).toEqual([40_000, 40_000, 40_000, 80_000]);
  });

  it('копейки от округления — по порядку вступления', () => {
    // 100 копеек на 1:1:1 → 33,33,33 и одна лишняя первому
    const shares = computeShares(100, { mode: 'shares', shares: [{ userId: 'c', weight: 1 }, { userId: 'a', weight: 1 }, { userId: 'b', weight: 1 }] }, order(['a', 'b', 'c']));
    expect(shares.map((s) => [s.userId, s.amount])).toEqual([['a', 34], ['b', 33], ['c', 33]]);
  });

  it('ноль долей — участник не делит расход', () => {
    const shares = computeShares(1000, { mode: 'shares', shares: [{ userId: 'a', weight: 0 }, { userId: 'b', weight: 3 }] }, order(['a', 'b']));
    expect(shares).toEqual([{ userId: 'b', amount: 1000, weight: 3, extra: false }]);
  });

  it('сумма долей всегда равна расходу', () => {
    const ids = ['a', 'b', 'c', 'd'];
    for (let total = 1; total < 5000; total += 101) {
      const shares = computeShares(total, { mode: 'shares', shares: ids.map((userId, i) => ({ userId, weight: i * 2 + 1 })) }, order(ids));
      expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(total);
    }
  });
});

describe('деление точными суммами', () => {
  it('принимает суммы, которые сходятся до копейки', () => {
    expect(amounts(computeShares(465_000, must(KAZAN_EXPENSES[2]).split, kazanOrder))).toEqual([120_000, 150_000, 95_000, 100_000]);
  });

  it('не принимает, если не хватает 150,00', () => {
    const split = { mode: 'exact' as const, shares: [{ userId: 'anya', amount: 120_000 }, { userId: 'boris', amount: 150_000 }, { userId: 'vika', amount: 95_000 }, { userId: 'gena', amount: 85_000 }] };
    expect(() => computeShares(465_000, split, kazanOrder)).toThrow(expect.objectContaining({ code: 'sum_mismatch' }));
  });

  it('не принимает отрицательные доли', () => {
    const split = { mode: 'exact' as const, shares: [{ userId: 'anya', amount: 2000 }, { userId: 'boris', amount: -1000 }] };
    expect(() => computeShares(1000, split, kazanOrder)).toThrow(expect.objectContaining({ code: 'bad_value' }));
  });
});

describe('ошибки деления', () => {
  it('не на кого делить', () => {
    expect(() => computeShares(1000, { mode: 'equal', userIds: [] }, kazanOrder)).toThrow(expect.objectContaining({ code: 'no_participants' }));
  });
  it('чужой человек', () => {
    expect(() => computeShares(1000, { mode: 'equal', userIds: ['anya', 'stranger'] }, kazanOrder)).toThrow(expect.objectContaining({ code: 'not_member' }));
  });
  it('один человек дважды', () => {
    expect(() => computeShares(1000, { mode: 'equal', userIds: ['anya', 'anya'] }, kazanOrder)).toThrow(expect.objectContaining({ code: 'duplicate_participant' }));
  });
  it('нулевая сумма', () => {
    expect(() => computeShares(0, { mode: 'equal', userIds: ['anya'] }, kazanOrder)).toThrow(expect.objectContaining({ code: 'bad_value' }));
  });
});

describe('контрольный пример «Поездка в Казань»', () => {
  const ledger = (taxi = 100_000): LedgerExpense[] =>
    KAZAN_EXPENSES.map((e, i) => {
      const amount = i === 1 ? taxi : e.amount;
      return { payerId: e.payer, amount, shares: computeShares(amount, e.split, kazanOrder) };
    });

  it('такси 1 000,00 на троих: Борис 333,34, Вика и Гена по 333,33', () => {
    expect(amounts(must(ledger()[1]).shares)).toEqual([33_334, 33_333, 33_333]);
  });

  it('балансы после четырёх расходов', () => {
    const balances = computeBalances([...KAZAN_MEMBERS], ledger());
    expect(asRecord(balances)).toEqual(KAZAN_BALANCES_AFTER_EXPENSES);
    expect(balances.reduce((s, b) => s + b.amount, 0)).toBe(0);
  });

  it('три перевода, все — Ане', () => {
    const transfers = minimalTransfers(computeBalances([...KAZAN_MEMBERS], ledger()));
    expect(transfers).toEqual([
      { fromId: 'boris', toId: 'anya', amount: 423_334 },
      { fromId: 'gena', toId: 'anya', amount: 313_333 },
      { fromId: 'vika', toId: 'anya', amount: 3_333 },
    ]);
  });

  it('после погашения Бориса и правки такси баланс Бориса развернулся в плюс', () => {
    const s = KAZAN_BORIS_SETTLEMENT;
    const balances = computeBalances([...KAZAN_MEMBERS], ledger(KAZAN_TAXI_FIXED_AMOUNT), [{ fromId: s.from, toId: s.to, amount: s.amount }]);
    expect(asRecord(balances)).toEqual(KAZAN_BALANCES_AFTER_FIX);
    expect(minimalTransfers(balances)).toEqual(KAZAN_TRANSFERS_AFTER_FIX.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount })));
  });

  it('превью правки: текущие балансы − старый расход + новый = пересчёт с нуля', () => {
    const before = computeBalances([...KAZAN_MEMBERS], ledger());
    const oldTaxi = must(ledger()[1]);
    const newTaxi = must(ledger(KAZAN_TAXI_FIXED_AMOUNT)[1]);
    const preview = new Map(before.map((b) => [b.userId, b.amount]));
    for (const [id, v] of expenseEffect(oldTaxi)) preview.set(id, must(preview.get(id)) - v);
    for (const [id, v] of expenseEffect(newTaxi)) preview.set(id, must(preview.get(id)) + v);
    expect(Object.fromEntries(preview)).toEqual(asRecord(computeBalances([...KAZAN_MEMBERS], ledger(KAZAN_TAXI_FIXED_AMOUNT))));
  });
});

describe('минимальный набор переводов', () => {
  const b = (...amounts: number[]): Balance[] => amounts.map((amount, i) => ({ userId: `u${i}`, amount }));

  it('все в расчёте — переводов нет', () => {
    expect(minimalTransfers(b(0, 0, 0))).toEqual([]);
  });

  it('находит минимум там, где жадный алгоритм ошибается (решение 5 в DECISIONS)', () => {
    // Жадно: 4 перевода. Оптимум 3: пара +5000/−5000 рассчитывается отдельно.
    const transfers = minimalTransfers(b(5000, 4000, 2000, -5000, -6000));
    expect(transfers).toHaveLength(3);
    expect(transfers).toContainEqual({ fromId: 'u3', toId: 'u0', amount: 5000 });
  });

  it('после переводов все в нуле, и переводов не больше n−1', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rnd() * 9);
      const amounts = Array.from({ length: n - 1 }, () => Math.floor(rnd() * 20) * 500 - 5000);
      amounts.push(-amounts.reduce((s, a) => s + a, 0));
      const balances = b(...amounts);
      const transfers = minimalTransfers(balances);
      const left = new Map(balances.map((x) => [x.userId, x.amount]));
      for (const t of transfers) {
        expect(t.amount).toBeGreaterThan(0);
        left.set(t.fromId, must(left.get(t.fromId)) + t.amount);
        left.set(t.toId, must(left.get(t.toId)) - t.amount);
      }
      expect([...left.values()].every((v) => v === 0)).toBe(true);
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, balances.filter((x) => x.amount).length - 1));
    }
  });

  it('большая группа (больше 15 человек с балансом) считается жадно и быстро', () => {
    const amounts = Array.from({ length: 30 }, (_, i) => (i % 2 ? -1 : 1) * (1000 + i));
    amounts.push(-amounts.reduce((s, a) => s + a, 0));
    const started = Date.now();
    const transfers = minimalTransfers(b(...amounts));
    expect(Date.now() - started).toBeLessThan(200);
    expect(transfers.length).toBeLessThanOrEqual(30);
  });

  it('«каждый каждому» для четверых — 6 переводов', () => {
    expect(naiveTransferCount(4)).toBe(6);
  });
});

describe('суммы: текст ↔ число', () => {
  it('форматирует с пробелами и запятой', () => {
    expect(formatAmount(316_666, 'RUB')).toBe('3 166,66');
    expect(formatAmount(-3_333, 'RUB')).toBe('−33,33');
    expect(formatAmount(13_334, 'RUB', { sign: true })).toBe('+133,34');
    expect(formatAmount(0, 'RUB', { sign: true })).toBe('0,00');
    expect(formatAmount(1500, 'JPY')).toBe('1 500');
  });

  it('разбирает ввод', () => {
    expect(parseAmount('1 000,5', 'RUB')).toBe(100_050);
    expect(parseAmount('1000.50', 'RUB')).toBe(100_050);
    expect(parseAmount('12', 'RUB')).toBe(1200);
    expect(parseAmount('12,', 'RUB')).toBe(1200);
    expect(parseAmount('1,234', 'RUB')).toBeNull();
    expect(parseAmount('abc', 'RUB')).toBeNull();
    expect(parseAmount('', 'RUB')).toBeNull();
    expect(parseAmount('1500', 'JPY')).toBe(1500);
    expect(parseAmount('15,5', 'JPY')).toBeNull();
  });

  it('сумма для поля ввода', () => {
    expect(amountToInput(100_050, 'RUB')).toBe('1000,5');
    expect(amountToInput(120_000, 'RUB')).toBe('1200');
    expect(amountToInput(1, 'RUB')).toBe('0,01');
  });
});
