import type { GroupEventDto } from '@se/shared';
import { eq } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import { groupMembers } from '../db/schema.js';
import { EVENTS_CHANNEL, getEvent, type EventNotice } from '../events/service.js';

/** Открытый поток SSE одного браузера: куда писать события. */
export interface Subscriber {
  send: (event: GroupEventDto) => void;
  /** Могли пропустить события: клиенту перезагрузить данные целиком. */
  resync: () => void;
}

/**
 * Рассылка событий групп по открытым потокам SSE.
 *
 * Потоки хранятся по пользователю, а не по группе: участник, только что вступивший в группу,
 * сразу получает её события без переподключения. Кому слать, решается на каждое событие
 * по текущему составу группы, поэтому чужие события до браузера не доходят.
 *
 * Источник событий — Postgres LISTEN/NOTIFY: уведомление приходит только после коммита,
 * и так же работало бы при нескольких экземплярах сервера.
 */
export class RealtimeHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private unlisten: (() => Promise<void>) | null = null;

  async start(log: { error: (o: unknown, m?: string) => void }): Promise<void> {
    let listening = false;
    const sub = await sql.listen(
      EVENTS_CHANNEL,
      (raw) => {
        this.dispatch(raw).catch((err: unknown) => {
          log.error(err, 'realtime dispatch failed');
        });
      },
      () => {
        // postgres-js сам переподписывается после обрыва соединения с базой, но NOTIFY за время
        // обрыва потеряны: просим всех подключённых клиентов перезагрузить данные.
        if (listening) this.resyncAll();
        listening = true;
      },
    );
    this.unlisten = () => sub.unlisten();
  }

  async stop(): Promise<void> {
    await this.unlisten?.();
    this.unlisten = null;
    this.subscribers.clear();
  }

  /** Подписывает поток пользователя. Возвращает функцию отписки (вызывать при закрытии соединения). */
  add(userId: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(userId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(userId, set);
    return () => {
      set.delete(subscriber);
      if (!set.size) this.subscribers.delete(userId);
    };
  }

  private resyncAll(): void {
    for (const set of this.subscribers.values()) for (const s of set) s.resync();
  }

  private async dispatch(raw: string): Promise<void> {
    const notice = JSON.parse(raw) as EventNotice;
    const event = await getEvent(db, notice.id);
    if (!event) return;
    const members = await db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, notice.groupId));
    for (const { userId } of members) {
      for (const subscriber of this.subscribers.get(userId) ?? []) subscriber.send(event);
    }
  }
}
