import type { WsServerMessage } from '@se/shared';
import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { db, sql } from '../db/client.js';
import { groupMembers } from '../db/schema.js';
import { EVENTS_CHANNEL, getEvent, type EventNotice } from '../events/service.js';

/**
 * Рассылка событий групп по WebSocket.
 *
 * Сокеты хранятся по пользователю, а не по группе: участник, только что вступивший в группу,
 * сразу получает её события без переподключения. Кому слать, решается на каждое событие
 * по текущему составу группы, поэтому чужие события до сокета не доходят.
 *
 * Источник событий — Postgres LISTEN/NOTIFY: уведомление приходит только после коммита,
 * и так же работало бы при нескольких экземплярах сервера.
 */
export class RealtimeHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private unlisten: (() => Promise<void>) | null = null;

  async start(log: { error: (o: unknown, m?: string) => void }): Promise<void> {
    const sub = await sql.listen(EVENTS_CHANNEL, (raw) => {
      this.dispatch(raw).catch((err: unknown) => {
        log.error(err, 'realtime dispatch failed');
      });
    });
    this.unlisten = () => sub.unlisten();
  }

  async stop(): Promise<void> {
    await this.unlisten?.();
    this.unlisten = null;
    for (const set of this.sockets.values()) for (const s of set) s.close(1001, 'server shutdown');
    this.sockets.clear();
  }

  add(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.sockets.set(userId, set);
    socket.on('close', () => {
      set.delete(socket);
      if (!set.size) this.sockets.delete(userId);
    });
  }

  private async dispatch(raw: string): Promise<void> {
    const notice = JSON.parse(raw) as EventNotice;
    const event = await getEvent(db, notice.id);
    if (!event) return;
    const members = await db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, notice.groupId));
    const message = JSON.stringify({ type: 'group_event', event } satisfies WsServerMessage);
    for (const { userId } of members) {
      for (const socket of this.sockets.get(userId) ?? []) {
        if (socket.readyState === socket.OPEN) socket.send(message);
      }
    }
  }
}
