import { SSE_EVENTS, type GroupEventDto } from '@se/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { useMe } from './auth.js';
import { invalidateGroup, qk } from './keys.js';

/**
 * Живые обновления: один поток SSE (GET /api/events/stream) на вкладку, пока человек вошёл.
 * Событие группы инвалидирует её запросы; открытую форму правки не трогаем — оптимистичная
 * блокировка держится на версии, с которой человек начал править.
 */

export interface RealtimeStatus {
  /** false — связи нет дольше OFFLINE_AFTER_MS. */
  online: boolean;
  /** Момент, до которого данные точно свежие (мс). */
  freshAt: number;
}

type Listener = (event: GroupEventDto) => void;

/** Короткие обрывы не показываем: браузер переподключается сам за пару секунд. */
const OFFLINE_AFTER_MS = 3000;
/** Если браузер сдался (поток закрыт насовсем), пробуем сами через столько. */
const REOPEN_MS = 3000;
const STREAM_URL = '/api/events/stream';

const StatusContext = createContext<RealtimeStatus>({ online: true, freshAt: Date.now() });
const ListenersContext = createContext<Set<Listener>>(new Set());

/** Расход, которого касается событие (если касается). */
function expenseIdOf(event: GroupEventDto): string | null {
  const p = event.payload;
  switch (p.type) {
    case 'expense_created':
      return p.after.id;
    case 'expense_updated':
      return p.after.id;
    case 'expense_deleted':
      return p.before.id;
    case 'member_joined':
    case 'group_updated':
      return null;
  }
}

/** Кэш расхода выкидываем, только если его не держит открытая форма: она живёт на своей версии. */
function dropExpense(qc: QueryClient, id: string | null) {
  if (id) qc.removeQueries({ queryKey: qk.expense(id), type: 'inactive' });
}

/** Пропущено слишком много: перезапросить всё, кроме расходов в открытых формах. */
function resyncAll(qc: QueryClient) {
  qc.removeQueries({ queryKey: ['expense'], type: 'inactive' });
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'expense' });
}

interface Handlers {
  onEvent: (event: GroupEventDto) => void;
  onResync: () => void;
  setStatus: (s: RealtimeStatus) => void;
}

/**
 * Соединение с переподключением. Пока EventSource жив, он переподключается сам и присылает Last-Event-ID —
 * сервер досылает пропущенное. Если поток закрыт насовсем или браузер сообщил о потере сети,
 * открываем новый и передаём id последнего события в адресе (новый EventSource заголовок не шлёт).
 * Если событий ещё не было, после ready перезапрашиваем всё; если сервер не может дослать — он пришлёт resync.
 */
function openConnection(h: Handlers): () => void {
  let es: EventSource | null = null;
  let lostAt: number | null = null;
  let needResync = false;
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  let lastId: string | null = null;

  const markLost = () => {
    if (lostAt !== null) return;
    const at = Date.now();
    lostAt = at;
    offlineTimer = setTimeout(() => {
      h.setStatus({ online: false, freshAt: at });
    }, OFFLINE_AFTER_MS);
  };
  const markReady = () => {
    clearTimeout(offlineTimer);
    lostAt = null;
    h.setStatus({ online: true, freshAt: Date.now() });
    if (needResync) h.onResync();
    needResync = false;
  };
  const onGroupEvent = (msg: MessageEvent<string>) => {
    const event = JSON.parse(msg.data) as GroupEventDto;
    if (seen.has(event.id)) return;
    seen.add(event.id);
    lastId = event.id;
    h.onEvent(event);
  };
  const reopen = () => {
    es?.close();
    needResync = lastId === null;
    open();
  };
  function open() {
    clearTimeout(reopenTimer);
    const source = new EventSource(lastId ? `${STREAM_URL}?lastEventId=${encodeURIComponent(lastId)}` : STREAM_URL);
    es = source;
    source.addEventListener(SSE_EVENTS.groupEvent, onGroupEvent);
    source.addEventListener(SSE_EVENTS.resync, h.onResync);
    source.addEventListener(SSE_EVENTS.ready, markReady);
    source.onerror = () => {
      markLost();
      if (source.readyState === EventSource.CLOSED) reopenTimer = setTimeout(reopen, REOPEN_MS);
    };
  }
  // Браузер знает, что сети нет: старое соединение больше ничего не принесёт, закрываем его сами.
  const onBrowserOffline = () => {
    markLost();
    es?.close();
  };
  // После возврата сети старое соединение может оказаться «мёртвым», а мы об этом не узнаем: открываем новое.
  const onBrowserOnline = () => {
    if (lostAt !== null && es?.readyState !== EventSource.CONNECTING) reopen();
  };

  open();
  window.addEventListener('offline', onBrowserOffline);
  window.addEventListener('online', onBrowserOnline);
  return () => {
    window.removeEventListener('offline', onBrowserOffline);
    window.removeEventListener('online', onBrowserOnline);
    clearTimeout(offlineTimer);
    clearTimeout(reopenTimer);
    es?.close();
  };
}

/** Держит поток для вошедшего пользователя и раздаёт события подписчикам (тосты, формы). */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const userId = useMe().data?.id ?? null;
  const [status, setStatus] = useState<RealtimeStatus>(() => ({ online: true, freshAt: Date.now() }));
  const [listeners] = useState(() => new Set<Listener>());

  const onEvent = useEffectEvent((event: GroupEventDto) => {
    void invalidateGroup(qc, event.groupId);
    dropExpense(qc, expenseIdOf(event));
    for (const l of listeners) l(event);
  });
  const onResync = useEffectEvent(() => {
    resyncAll(qc);
  });

  useEffect(() => {
    if (!userId) return;
    return openConnection({
      onEvent: (e) => {
        onEvent(e);
      },
      onResync: () => {
        onResync();
      },
      setStatus,
    });
  }, [userId]);

  return (
    <StatusContext.Provider value={status}>
      <ListenersContext.Provider value={listeners}>{children}</ListenersContext.Provider>
    </StatusContext.Provider>
  );
}

/** Есть ли связь с сервером и на какой момент данные свежие. */
export const useRealtimeStatus = () => useContext(StatusContext);

/** Подписка на события групп из потока (уже после инвалидации кэша). */
export function useGroupEventListener(handler: Listener) {
  const listeners = useContext(ListenersContext);
  const onEvent = useEffectEvent(handler);
  useEffect(() => {
    const l: Listener = (e) => {
      onEvent(e);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [listeners]);
}
