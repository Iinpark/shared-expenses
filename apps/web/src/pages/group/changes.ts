import type { BalancesDto, ExpenseDto } from '@se/shared';
import { useMemo, useState } from 'react';

/**
 * Что поменялось, пока экран группы открыт (D02): ключ → старое значение (null — строка новая).
 * Свои правки делаются в форме, на другом экране, поэтому всё, что меняется здесь, пришло от других.
 * Исключение — подтверждение погашения на самом экране группы: о нём говорят заранее (expectOwn).
 * Отметки живут, пока человек не ушёл с экрана.
 */
export type Marks = ReadonlyMap<string, number | null>;

export const markKey = {
  myBalance: 'me',
  balance: (userId: string) => `b:${userId}`,
  expense: (id: string) => `e:${id}`,
};

function valuesOf(meId: string, balances: BalancesDto, expenses: ExpenseDto[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const b of balances.balances) values.set(markKey.balance(b.userId), b.amount);
  values.set(markKey.myBalance, balances.balances.find((b) => b.userId === meId)?.amount ?? 0);
  for (const e of expenses) values.set(markKey.expense(e.id), e.amount);
  return values;
}

/** Самое первое старое значение остаётся, пока число не вернулось к нему; null — строка появилась при открытом экране. */
function nextMark(marks: Marks, prev: ReadonlyMap<string, number>, key: string, value: number): number | null | undefined {
  const original = marks.get(key);
  const before = prev.get(key);
  if (original !== undefined && original !== null) return original === value ? undefined : original;
  // Новая строка: пока число то же — просто «новая», а если поменялось — помним, каким оно пришло.
  if (before === undefined) return null;
  if (before === value) return marks.has(key) ? null : undefined;
  return before;
}

function nextMarks(marks: Marks, prev: ReadonlyMap<string, number>, cur: ReadonlyMap<string, number>): Marks {
  const next = new Map<string, number | null>();
  for (const [key, value] of cur) {
    const mark = nextMark(marks, prev, key, value);
    if (mark !== undefined) next.set(key, mark);
  }
  return next;
}

const NO_MARKS: Marks = new Map();

export interface ChangeMarks {
  marks: Marks;
  /**
   * Следующее изменение цифр — своё (например, подтверждение погашения прямо на экране группы):
   * не подсвечивать его как чужое. false — своё действие не удалось, ждать больше нечего.
   */
  expectOwn: (on: boolean) => void;
}

export function useChangeMarks(groupId: string, meId: string, balances: BalancesDto, expenses: ExpenseDto[]): ChangeMarks {
  const values = useMemo(() => valuesOf(meId, balances, expenses), [meId, balances, expenses]);
  const [seen, setSeen] = useState({ groupId, values });
  const [marks, setMarks] = useState(NO_MARKS);
  const [own, setOwn] = useState(false);
  if (seen.values !== values) {
    // Подстройка состояния под новые данные прямо в рендере — так React советует вместо эффекта.
    setSeen({ groupId, values });
    if (own) setOwn(false);
    else setMarks(seen.groupId === groupId ? nextMarks(marks, seen.values, values) : NO_MARKS);
  }
  return { marks, expectOwn: setOwn };
}
