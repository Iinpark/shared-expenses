import { useEffect } from 'react';
import { memberOf } from '../lib/events.js';
import { useCurrentUser, useGroupLookup, useGroups, usePendingToMe } from '../lib/queries/index.js';
import { plural } from '../lib/ru.js';
import { oldestOverdue, overdueDays } from '../lib/settlements.js';
import { useToast, type ToastContent } from './Toast.js';

const SHOWN_KEY = 'se:nudge-shown';
/** Запасной флаг, если sessionStorage недоступен: тогда — раз за загрузку страницы. */
let shownInMemory = false;

function alreadyShown(): boolean {
  try {
    return shownInMemory || sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return shownInMemory;
  }
}

function markShown() {
  shownInMemory = true;
  try {
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    // Без хранилища хватит флага в памяти.
  }
}

/**
 * Напоминание получателю (DECISIONS, раздел 9): если перевод тебе ждёт подтверждения три дня и дольше,
 * при входе в приложение один раз за сессию — тост «Гена ждёт подтверждения перевода уже 4 дня» со ссылкой на M08.
 * Запросы те же, что у списка групп (M01), поэтому идут из кэша.
 */
export function NudgeToast() {
  const me = useCurrentUser();
  const groups = useGroups();
  const toast = useToast();
  const lookup = useGroupLookup();
  const ids = (groups.data ?? []).filter((g) => g.status === 'open' && g.myBalance > 0).map((g) => g.id);
  const pending = usePendingToMe(ids, me.id);
  const target = oldestOverdue([...pending.values()].flat());

  useEffect(() => {
    if (!target || alreadyShown()) return;
    markShown();
    lookup(target.groupId).then(
      (g) => {
        const days = overdueDays(target) ?? 0;
        const from = memberOf(g, target.fromId)?.name ?? 'Бывший участник';
        const content: ToastContent = {
          text: `${from} ждёт подтверждения перевода уже ${String(days)} ${plural(days, 'день', 'дня', 'дней')}`,
          sub: g.name,
          action: { label: 'Посмотреть', to: `/groups/${g.id}/settlements/${target.id}` },
        };
        toast(content);
      },
      () => undefined, // группу не достали — напомним карточкой на её экране
    );
  }, [target, lookup, toast]);
  return null;
}
