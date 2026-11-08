import { currencySymbol, formatAmount, type BalancesDto, type CurrencyCode, type ExpenseCategory, type ExpenseDto } from '@se/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { copy } from './copy.js';

export const useExpenses = (groupId: string) =>
  useQuery({ queryKey: ['expenses', groupId], queryFn: () => api<ExpenseDto[]>('GET', `/api/groups/${groupId}/expenses`), retry: false });

export const useBalances = (groupId: string) =>
  useQuery({ queryKey: ['balances', groupId], queryFn: () => api<BalancesDto>('GET', `/api/groups/${groupId}/balances`), retry: false });

/** После любого изменения расходов: балансы группы, список расходов, сама группа и список групп. */
export function invalidateGroup(qc: QueryClient, groupId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['expenses', groupId] }),
    qc.invalidateQueries({ queryKey: ['balances', groupId] }),
    qc.invalidateQueries({ queryKey: ['group', groupId] }),
    qc.invalidateQueries({ queryKey: ['groups'] }),
  ]);
}

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: copy.expense.categories[0]!,
  transport: copy.expense.categories[1]!,
  housing: copy.expense.categories[2]!,
  fun: copy.expense.categories[3]!,
  other: copy.expense.categories[4]!,
};

/** «1 000,00» в валюте группы. */
export const money = (minor: number, currency: string, sign = false) => formatAmount(minor, currency as CurrencyCode, { sign });

/** «1 000,00 ₽». */
export const moneyCur = (minor: number, currency: string) => `${money(minor, currency)} ${currencySymbol(currency as CurrencyCode)}`;

/** Сегодняшняя дата в формате YYYY-MM-DD по часам пользователя. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** «16 окт» для даты траты YYYY-MM-DD или момента ISO (момент — по часам пользователя). */
export function shortDate(iso: string): string {
  if (iso.length > 10) {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

/** Описание деления для таблицы: «поровну на троих», «долями 1 : 1 : 1 : 2», «точными суммами». */
export function splitLabel(e: ExpenseDto, memberCount: number): string {
  if (e.splitMode === 'exact') return 'точными суммами';
  if (e.splitMode === 'shares') return `долями ${e.shares.map((s) => s.weight).join(' : ')}`;
  const n = e.shares.length;
  if (n === 1) return 'на одного';
  return n === memberCount ? `поровну на ${n}` : `поровну на ${GENITIVE_COUNT[n] ?? n}`;
}

/** «двоих», «троих»: сколько человек делят расход. */
const GENITIVE_COUNT: Record<number, string> = { 2: 'двоих', 3: 'троих', 4: 'четверых', 5: 'пятерых', 6: 'шестерых', 7: 'семерых' };

/** «хватит трёх»: родительный падеж числа переводов. */
export const countGenitive = (n: number) => ['', 'одного', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти', 'десяти'][n] ?? String(n);
