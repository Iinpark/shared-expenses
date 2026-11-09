import {
  amountToInput,
  computeShares,
  MAX_AMOUNT,
  parseAmount,
  SplitError,
  type CurrencyCode,
  type ExpenseCategory,
  type ExpenseDto,
  type ExpenseInput,
  type GroupDto,
  type ShareResult,
  type SplitInput,
  type SplitMode,
} from '@se/shared';
import { useMemo, useState } from 'react';
import { errorText } from '../../lib/api.js';
import { copy, fill } from '../../lib/copy.js';
import { CATEGORY_LABELS, today } from '../../lib/expenses.js';

export type Weights = Record<string, number>;
export type Texts = Record<string, string>;

interface Fields {
  amountText: string;
  title: string;
  category: ExpenseCategory;
  payerId: string;
  spentOn: string;
  comment: string;
  mode: SplitMode;
}

/** Начальные значения полей: из расхода при правке, по умолчанию для нового. */
function initialFields(expense: ExpenseDto | undefined, meId: string, currency: CurrencyCode): Fields {
  if (!expense) return { amountText: '', title: '', category: 'other', payerId: meId, spentOn: today(), comment: '', mode: 'equal' };
  return {
    amountText: amountToInput(expense.amount, currency),
    title: expense.title,
    category: expense.category,
    payerId: expense.payerId,
    spentOn: expense.spentOn,
    comment: expense.comment ?? '',
    mode: expense.splitMode,
  };
}

const sharesIn = (expense: ExpenseDto | undefined, mode: SplitMode) => (expense?.splitMode === mode ? expense.shares : null);

function initialSelected(expense: ExpenseDto | undefined, memberIds: string[]): Set<string> {
  const shares = sharesIn(expense, 'equal');
  return new Set(shares ? shares.map((s) => s.userId) : memberIds);
}

function initialWeights(expense: ExpenseDto | undefined, memberIds: string[]): Weights {
  const shares = sharesIn(expense, 'shares');
  return Object.fromEntries(memberIds.map((id) => [id, shares ? (shares.find((s) => s.userId === id)?.weight ?? 0) : 1]));
}

function initialExact(expense: ExpenseDto | undefined, memberIds: string[], currency: CurrencyCode): Texts {
  const shares = sharesIn(expense, 'exact') ?? [];
  return Object.fromEntries(
    memberIds.map((id) => {
      const s = shares.find((x) => x.userId === id);
      return [id, s ? amountToInput(s.amount, currency) : ''];
    }),
  );
}

/** Деление в виде запроса к API из состояния формы. */
export function buildSplit(mode: SplitMode, memberIds: string[], selected: Set<string>, weights: Weights, exact: Texts, currency: CurrencyCode): SplitInput {
  switch (mode) {
    case 'equal':
      return { mode, userIds: memberIds.filter((id) => selected.has(id)) };
    case 'shares':
      return { mode, shares: memberIds.map((userId) => ({ userId, weight: weights[userId] ?? 0 })) };
    case 'exact':
      return { mode, shares: memberIds.map((userId) => ({ userId, amount: parseAmount(exact[userId] ?? '', currency) ?? 0 })) };
  }
}

/** Превью долей тем же кодом, что и на сервере (packages/shared/src/split.ts). */
export function previewShares(total: number | null, split: SplitInput, joinOrder: ReadonlyMap<string, number>): { shares: ShareResult[] | null; splitError: string | null } {
  if (!total) return { shares: null, splitError: null };
  try {
    return { shares: computeShares(total, split, joinOrder), splitError: null };
  } catch (err) {
    return { shares: null, splitError: err instanceof SplitError ? err.message : errorText(err) };
  }
}

/** Сумма из поля: null, если пусто, опечатка или больше лимита сервера. */
export function parseTotal(text: string, currency: CurrencyCode) {
  const parsed = parseAmount(text, currency);
  const tooBig = parsed !== null && parsed > MAX_AMOUNT;
  return { parsed, tooBig, total: tooBig ? null : parsed };
}

function defaultTitle(category: ExpenseCategory): string {
  if (category !== 'other') return CATEGORY_LABELS[category];
  return fill(copy.expense.autoName, { time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) });
}

export function useExpenseDraft(g: GroupDto, expense: ExpenseDto | undefined, meId: string) {
  const currency = g.currency as CurrencyCode;
  const memberIds = useMemo(() => g.members.map((m) => m.userId), [g.members]);
  const joinOrder = useMemo(() => new Map(g.members.map((m) => [m.userId, m.joinOrder])), [g.members]);
  const [init] = useState(() => initialFields(expense, meId, currency));

  const [amountText, setAmountText] = useState(init.amountText);
  const [title, setTitle] = useState(init.title);
  const [category, setCategory] = useState<ExpenseCategory>(init.category);
  const [payerId, setPayerId] = useState(init.payerId);
  const [spentOn, setSpentOn] = useState(init.spentOn);
  const [comment, setComment] = useState(init.comment);
  const [mode, setMode] = useState<SplitMode>(init.mode);
  const [selected, setSelected] = useState(() => initialSelected(expense, memberIds));
  const [weights, setWeights] = useState(() => initialWeights(expense, memberIds));
  const [exact, setExact] = useState(() => initialExact(expense, memberIds, currency));
  const [lastEdited, setLastEdited] = useState<string | null>(null);

  const { parsed, tooBig, total } = parseTotal(amountText, currency);
  const split = buildSplit(mode, memberIds, selected, weights, exact, currency);
  const { shares, splitError } = previewShares(total, split, joinOrder);
  const exactBad = mode === 'exact' && Object.values(exact).some((t) => t.trim() !== '' && parseAmount(t, currency) === null);

  return {
    currency,
    memberIds,
    amountText,
    setAmountText,
    title,
    setTitle,
    category,
    setCategory,
    payerId,
    setPayerId,
    spentOn,
    setSpentOn,
    comment,
    setComment,
    mode,
    setMode,
    selected,
    weights,
    exact,
    lastEdited,
    parsed,
    tooBig,
    total,
    split,
    shares,
    splitError,
    exactBad,
    toggle(userId: string) {
      const next = new Set(selected);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      setSelected(next);
    },
    setWeight(userId: string, value: number) {
      setWeights({ ...weights, [userId]: Math.max(0, Math.min(99, value)) });
    },
    setExactFor(userId: string, text: string) {
      setExact({ ...exact, [userId]: text });
      setLastEdited(userId);
    },
    fixExact(userId: string, value: number) {
      setExact({ ...exact, [userId]: amountToInput(value, currency) });
    },
    /** Тело запроса. Пустое название заменяется категорией или «Расход в 14:32». */
    input(amount: number): ExpenseInput {
      return { amount, title: title.trim() || defaultTitle(category), category, payerId, spentOn, comment: comment.trim() || null, split };
    },
  };
}

export type Draft = ReturnType<typeof useExpenseDraft>;
