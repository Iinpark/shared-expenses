import type { SplitInput } from '../split.js';

/**
 * Контрольный пример «Поездка в Казань» из брифа и HANDOFF (раздел 4).
 * Участники в порядке вступления: Аня, Борис, Вика, Гена. Суммы в копейках.
 * Используется в тестах логики денег и в серверных тестах API.
 */
export const KAZAN_MEMBERS = ['anya', 'boris', 'vika', 'gena'] as const;
export type KazanMember = (typeof KAZAN_MEMBERS)[number];

export const KAZAN_EXPENSES: { title: string; payer: KazanMember; amount: number; split: SplitInput }[] = [
  { title: 'Квартира на 3 ночи', payer: 'anya', amount: 1_200_000, split: { mode: 'equal', userIds: ['anya', 'boris', 'vika', 'gena'] } },
  { title: 'Такси из аэропорта', payer: 'boris', amount: 100_000, split: { mode: 'equal', userIds: ['boris', 'vika', 'gena'] } },
  {
    title: 'Ужин',
    payer: 'vika',
    amount: 465_000,
    split: {
      mode: 'exact',
      shares: [
        { userId: 'anya', amount: 120_000 },
        { userId: 'boris', amount: 150_000 },
        { userId: 'vika', amount: 95_000 },
        { userId: 'gena', amount: 100_000 },
      ],
    },
  },
  {
    title: 'Музей, Гена с сыном',
    payer: 'gena',
    amount: 200_000,
    split: {
      mode: 'shares',
      shares: [
        { userId: 'anya', weight: 1 },
        { userId: 'boris', weight: 1 },
        { userId: 'vika', weight: 1 },
        { userId: 'gena', weight: 2 },
      ],
    },
  },
];

/** Балансы после четырёх расходов. */
export const KAZAN_BALANCES_AFTER_EXPENSES: Record<KazanMember, number> = {
  anya: 740_000,
  boris: -423_334,
  vika: -3_333,
  gena: -313_333,
};

/** Борис погасил весь свой долг Ане, Аня подтвердила. */
export const KAZAN_BORIS_SETTLEMENT = { from: 'boris', to: 'anya', amount: 423_334 } as const;

/** Такси исправлено с 1 000 на 1 200. Ожидающее погашение Гены (2 000) не учитывается. */
export const KAZAN_TAXI_FIXED_AMOUNT = 120_000;

export const KAZAN_BALANCES_AFTER_FIX: Record<KazanMember, number> = {
  anya: 316_666,
  boris: 13_334,
  vika: -10_000,
  gena: -320_000,
};

export const KAZAN_TRANSFERS_AFTER_FIX = [
  { from: 'gena', to: 'anya', amount: 316_666 },
  { from: 'gena', to: 'boris', amount: 3_334 },
  { from: 'vika', to: 'boris', amount: 10_000 },
] as const;
