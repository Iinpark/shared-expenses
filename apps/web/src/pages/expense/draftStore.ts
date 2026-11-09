import { EXPENSE_CATEGORIES } from '@se/shared';
import type { Fields, Texts, Weights } from './draft.js';

/**
 * Черновик нового расхода в localStorage, отдельно для каждой группы: форма переживает
 * обрыв связи и перезагрузку (S03 «Нет связи»). Хранилища может не быть (приватный режим) — тогда без черновика.
 */
export interface StoredDraft extends Fields {
  selected: string[];
  weights: Weights;
  exact: Texts;
}

const key = (groupId: string) => `se:expense-draft:${groupId}`;

const isStringRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Черновик из хранилища, если он похож на наш; плательщик и выбранные — только из нынешних участников. */
function looksLikeDraft(raw: unknown): raw is StoredDraft {
  if (!isStringRecord(raw)) return false;
  const d = raw as Partial<StoredDraft>;
  const strings = [d.amountText, d.title, d.spentOn, d.comment, d.payerId].every((v) => typeof v === 'string');
  const modeOk = d.mode === 'equal' || d.mode === 'shares' || d.mode === 'exact';
  return strings && modeOk && EXPENSE_CATEGORIES.some((c) => c === d.category) && Array.isArray(d.selected);
}

function sanitize(raw: unknown, memberIds: string[], meId: string): StoredDraft | null {
  if (!looksLikeDraft(raw)) return null;
  const draft = raw;
  return {
    ...draft,
    payerId: memberIds.includes(draft.payerId) ? draft.payerId : meId,
    selected: draft.selected.filter((id) => memberIds.includes(id)),
    weights: isStringRecord(draft.weights) ? draft.weights : {},
    exact: isStringRecord(draft.exact) ? draft.exact : {},
  };
}

export function loadDraft(groupId: string, memberIds: string[], meId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key(groupId));
    return raw ? sanitize(JSON.parse(raw), memberIds, meId) : null;
  } catch {
    return null;
  }
}

/** Пустую форму не храним: открыть её заново ничего не стоит. */
export function saveDraft(groupId: string, draft: StoredDraft) {
  try {
    if (!draft.amountText.trim() && !draft.title.trim() && !draft.comment.trim()) localStorage.removeItem(key(groupId));
    else localStorage.setItem(key(groupId), JSON.stringify(draft));
  } catch {
    // Нет хранилища — черновик просто не переживёт перезагрузку.
  }
}

export function clearDraft(groupId: string) {
  try {
    localStorage.removeItem(key(groupId));
  } catch {
    // См. saveDraft.
  }
}
