import { must, type GroupEventsPage, type WsServerMessage } from '@se/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { sql } from '../src/db/client.js';
import { expenseOf, groupOf, login, makeApp, resetDb } from './helpers.js';

const app = await makeApp();
await app.ready();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

type Cookie = string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', cookie: Cookie, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });
const feedOf = (res: { json: () => unknown }) => res.json() as GroupEventsPage;

/** Подключение к /ws, которое складывает все сообщения сервера. */
async function connect(cookie: Cookie | null) {
  const messages: WsServerMessage[] = [];
  let closeCode: number | null = null;
  const socket: WebSocket = await app.injectWS('/ws', { headers: cookie ? { cookie } : {} }, {
    onInit: (ws) => {
      ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as WsServerMessage));
      ws.on('close', (code: number) => (closeCode = code));
    },
  });
  const events = () => messages.flatMap((m) => (m.type === 'group_event' ? [m.event] : []));
  return { socket, messages, events, closeCode: () => closeCode };
}

/** Ждёт, пока условие станет правдой: события приходят асинхронно, после коммита. */
async function until(check: () => boolean, ms = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('не дождались события');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function setup() {
  const anya = await login(app, 'anya@example.com', 'Аня', 'f');
  const boris = await login(app, 'boris@example.com', 'Борис', 'm');
  const group = groupOf(await req('POST', anya, '/api/groups', { name: 'Поездка в Казань', currency: 'RUB', reminderDays: 7 }));
  await req('POST', boris, `/api/invites/${group.inviteToken}/accept`);
  const full = groupOf(await req('GET', anya, `/api/groups/${group.id}`));
  const id = (name: string) => must(full.members.find((m) => m.name === name)).userId;
  const taxi = (amount: number, version?: number) => ({
    amount,
    title: 'Такси',
    category: 'transport',
    payerId: id('Борис'),
    spentOn: '2026-10-16',
    split: { mode: 'equal', userIds: [id('Аня'), id('Борис')] },
    ...(version ? { version } : {}),
  });
  return { anya, boris, groupId: group.id, taxi };
}

describe('лента группы', () => {
  it('пишет вступление, добавление, правку и удаление расхода со снимками «до» и «после»', async () => {
    const { anya, boris, groupId, taxi } = await setup();
    const created = expenseOf(await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(100_000)));
    await req('PUT', boris, `/api/expenses/${created.id}`, taxi(120_000, 1));
    await req('DELETE', anya, `/api/expenses/${created.id}?version=2`);

    const feed = feedOf(await req('GET', anya, `/api/groups/${groupId}/events`));
    expect(feed.events.map((e) => e.payload.type)).toEqual(['expense_deleted', 'expense_updated', 'expense_created', 'member_joined']);
    const updated = must(feed.events[1]);
    expect(updated.actorName).toBe('Борис');
    expect(updated.payload).toMatchObject({ type: 'expense_updated', before: { amount: 100_000 }, after: { amount: 120_000 } });
    expect(must(feed.events[0]).actorName).toBe('Аня');
  });

  it('листается страницами без пропусков и повторов', async () => {
    const { boris, groupId, taxi } = await setup();
    for (let i = 1; i <= 5; i++) await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(i * 1000));
    const ids: string[] = [];
    let before: string | null = null;
    do {
      const page: GroupEventsPage = feedOf(await req('GET', boris, `/api/groups/${groupId}/events?limit=2${before ? `&before=${before}` : ''}`));
      ids.push(...page.events.map((e) => e.id));
      before = page.nextBefore;
    } while (before);
    expect(ids).toHaveLength(6); // 5 расходов + вступление Бориса
    expect(new Set(ids).size).toBe(6);
  });

  it('смена настроек попадает в ленту с тем, что было и что стало', async () => {
    const { anya, groupId } = await setup();
    await req('PATCH', anya, `/api/groups/${groupId}`, { name: 'Казань 2026', reminderDays: 7 });
    const [last] = feedOf(await req('GET', anya, `/api/groups/${groupId}/events`)).events;
    expect(must(last).payload).toEqual({ type: 'group_updated', changes: [{ field: 'name', from: 'Поездка в Казань', to: 'Казань 2026' }] });
  });

  it('чужой ленту не видит', async () => {
    const { groupId } = await setup();
    const stranger = await login(app, 'x@example.com', 'Икс');
    expect((await req('GET', stranger, `/api/groups/${groupId}/events`)).statusCode).toBe(404);
  });
});

describe('живые обновления по WebSocket', () => {
  it('участники группы получают событие сразу после сохранения, чужой — нет', async () => {
    const { anya, boris, groupId, taxi } = await setup();
    const stranger = await login(app, 'x@example.com', 'Икс');
    const a = await connect(anya);
    const x = await connect(stranger);

    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(100_000));
    await until(() => a.events().length === 1);
    expect(must(a.events()[0]).payload).toMatchObject({ type: 'expense_created', after: { title: 'Такси', amount: 100_000 } });

    await new Promise((r) => setTimeout(r, 200));
    expect(x.events()).toEqual([]);
    a.socket.terminate();
    x.socket.terminate();
  });

  it('отклонённая правка (нет прав) никому не рассылается', async () => {
    const { anya, boris, groupId, taxi } = await setup();
    const vika = await login(app, 'vika@example.com', 'Вика', 'f');
    const group = groupOf(await req('GET', anya, `/api/groups/${groupId}`));
    await req('POST', vika, `/api/invites/${group.inviteToken}/accept`);
    const a = await connect(anya);
    const created = expenseOf(await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(100_000)));
    await until(() => a.events().some((e) => e.payload.type === 'expense_created'));

    expect((await req('PUT', vika, `/api/expenses/${created.id}`, taxi(1, 1))).statusCode).toBe(403);
    await new Promise((r) => setTimeout(r, 200));
    expect(a.events().some((e) => e.payload.type === 'expense_updated')).toBe(false);
    a.socket.terminate();
  });

  it('без входа соединение закрывается', async () => {
    const anon = await connect(null);
    await until(() => anon.closeCode() !== null);
    expect(anon.closeCode()).toBe(4401);
  });

  it('участник, вступивший после подключения, сразу получает события новой группы', async () => {
    const { anya, groupId, taxi } = await setup();
    const vika = await login(app, 'vika@example.com', 'Вика', 'f');
    const v = await connect(vika);
    const group = groupOf(await req('GET', anya, `/api/groups/${groupId}`));
    await req('POST', vika, `/api/invites/${group.inviteToken}/accept`);
    await until(() => v.events().some((e) => e.payload.type === 'member_joined'));

    await req('POST', anya, `/api/groups/${groupId}/expenses`, { ...taxi(5000), payerId: group.ownerId });
    await until(() => v.events().some((e) => e.payload.type === 'expense_created'));
    v.socket.terminate();
  });
});
