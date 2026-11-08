/**
 * Деление расхода на доли. Один и тот же код считает превью в форме и сохраняет расход на сервере,
 * поэтому цифры в форме и в базе не могут разойтись.
 *
 * Правило лишних копеек (HANDOFF, раздел 4): если сумма не делится ровно, остаток раздаётся
 * по одной копейке участникам в порядке вступления в группу, начиная с самого раннего.
 */

export type SplitMode = 'equal' | 'shares' | 'exact';

export type SplitInput =
  | { mode: 'equal'; userIds: string[] }
  | { mode: 'shares'; shares: { userId: string; weight: number }[] }
  | { mode: 'exact'; shares: { userId: string; amount: number }[] };

export interface ShareResult {
  userId: string;
  amount: number;
  /** Сколько долей у участника: в делении поровну 1, точными суммами — null. */
  weight: number | null;
  /** Получил лишнюю копейку из остатка (для подписи «+1 коп.» в форме). */
  extra: boolean;
}

export class SplitError extends Error {
  constructor(
    readonly code: 'no_participants' | 'duplicate_participant' | 'not_member' | 'sum_mismatch' | 'bad_value',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Делит total пропорционально весам. Каждый получает целую часть своей доли,
 * а копейки, оставшиеся от округления вниз, — по одной первым по порядку вступления.
 */
function splitByWeights(total: number, parts: { userId: string; weight: number }[], joinOrder: ReadonlyMap<string, number>): ShareResult[] {
  const ordered = [...parts].sort((a, b) => joinOrder.get(a.userId)! - joinOrder.get(b.userId)!);
  const weightSum = ordered.reduce((s, p) => s + p.weight, 0);
  const base = ordered.map((p) => Math.floor((total * p.weight) / weightSum));
  let left = total - base.reduce((s, a) => s + a, 0);
  // Остаток всегда меньше числа участников: каждый потерял при округлении меньше копейки.
  return ordered.map((p, i) => {
    const extra = left > 0;
    if (extra) left--;
    return { userId: p.userId, amount: base[i]! + (extra ? 1 : 0), weight: p.weight, extra };
  });
}

function assertParticipants(userIds: string[], joinOrder: ReadonlyMap<string, number>) {
  if (!userIds.length) throw new SplitError('no_participants', 'Выбери, на кого делить');
  if (new Set(userIds).size !== userIds.length) throw new SplitError('duplicate_participant', 'Участник указан дважды');
  if (userIds.some((id) => !joinOrder.has(id))) throw new SplitError('not_member', 'Делить можно только между участниками группы');
}

/**
 * Доли расхода. joinOrder — порядок вступления участников группы (userId → номер).
 * Результат отсортирован по порядку вступления; сумма долей всегда равна total, иначе SplitError.
 */
export function computeShares(total: number, split: SplitInput, joinOrder: ReadonlyMap<string, number>): ShareResult[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw new SplitError('bad_value', 'Сумма должна быть больше нуля');

  if (split.mode === 'equal') {
    assertParticipants(split.userIds, joinOrder);
    return splitByWeights(total, split.userIds.map((userId) => ({ userId, weight: 1 })), joinOrder);
  }

  if (split.mode === 'shares') {
    const parts = split.shares.filter((s) => s.weight > 0);
    assertParticipants(parts.map((p) => p.userId), joinOrder);
    if (parts.some((p) => !Number.isSafeInteger(p.weight))) throw new SplitError('bad_value', 'Число долей должно быть целым');
    return splitByWeights(total, parts, joinOrder);
  }

  const parts = split.shares.filter((s) => s.amount !== 0);
  assertParticipants(parts.map((p) => p.userId), joinOrder);
  if (parts.some((p) => !Number.isSafeInteger(p.amount) || p.amount < 0)) throw new SplitError('bad_value', 'Доля не может быть отрицательной');
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum !== total) throw new SplitError('sum_mismatch', 'Сумма долей должна совпадать с расходом до копейки');
  return parts
    .sort((a, b) => joinOrder.get(a.userId)! - joinOrder.get(b.userId)!)
    .map((p) => ({ userId: p.userId, amount: p.amount, weight: null, extra: false }));
}
