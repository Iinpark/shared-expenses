import { must, type GroupEventDto, type GroupEventsPage } from '@se/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/db/client.js';
import { expenseOf, groupOf, login, makeApp, resetDb } from './helpers.js';

const app = await makeApp();
// SSE — долгий поток, app.inject ждёт конца ответа. Поэтому настоящий сервер на свободном порту.
const base = await app.listen({ port: 0, host: '127.0.0.1' });
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

type Cookie = string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', cookie: Cookie, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });
const feedOf = (res: { json: () => unknown }) => res.json() as GroupEventsPage;

/** Подписка на поток SSE, которая разбирает кадры и складывает их. */
function connect(cookie: Cookie | null, lastEventId?: string) {
  return connectUrl(cookie, '/api/events/stream', lastEventId);
}

async function connectUrl(cookie: Cookie | null, path: string, lastEventId?: string) {
  const frames: { event: string; id: string | null; data: string }[] = [];
  const abort = new AbortController();
  const headers: Record<string, string> = cookie ? { cookie } : {};
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const res = await fetch(`${base}${path}`, { headers, signal: abort.signal });
  if (res.ok && res.body) {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let tail = '';
    void (async () => {
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
        if (chunk.done) return;
        tail += chunk.value;
        const parts = tail.split('\n\n');
        tail = parts.pop() ?? '';
        for (const part of parts) {
          const field = (name: string) => part.split('\n').find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;
          const event = field('event');
          if (event) frames.push({ event, id: field('id'), data: field('data') ?? '' });
        }
      }
    })();
  }
  const events = () => frames.flatMap((f) => (f.event === 'group_event' ? [JSON.parse(f.data) as GroupEventDto] : []));
  const has = (event: string) => frames.some((f) => f.event === event);
  return { status: res.status, events, has, close: () => { abort.abort(); } };
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

describe('живые обновления (SSE)', () => {
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
    a.close();
    x.close();
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
    a.close();
  });

  it('без входа поток не открывается', async () => {
    const anon = await connect(null);
    expect(anon.status).toBe(401);
  });

  it('после переподключения досылает пропущенное по Last-Event-ID, без повторов', async () => {
    const { anya, boris, groupId, taxi } = await setup();
    const first = await connect(anya);
    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(1000));
    await until(() => first.events().length === 1);
    const lastSeen = must(first.events()[0]).id;
    first.close();

    // Пока Аня без связи, Борис добавил ещё два расхода.
    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(2000));
    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(3000));

    const again = await connect(anya, lastSeen);
    await until(() => again.has('ready'));
    // Досылка идёт с запасом назад (повторы клиент отбрасывает по id), но последнее увиденное не повторяется,
    // а пропущенное приходит целиком и по порядку.
    const created = again.events().flatMap((e) => (e.payload.type === 'expense_created' ? [e.payload.after.amount] : []));
    expect(created.filter((a) => a !== 1000)).toEqual([2000, 3000]);
    expect(again.events().some((e) => e.id === lastSeen)).toBe(false);
    again.close();
  });

  it('id последнего события можно передать и в адресе (новый поток после потери сети)', async () => {
    const { anya, boris, groupId, taxi } = await setup();
    const first = await connect(anya);
    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(1000));
    await until(() => first.events().length === 1);
    const lastSeen = must(first.events()[0]).id;
    first.close();
    await req('POST', boris, `/api/groups/${groupId}/expenses`, taxi(2000));

    const again = await connectUrl(anya, `/api/events/stream?lastEventId=${lastSeen}`);
    await until(() => again.has('ready'));
    expect(again.events().some((e) => e.payload.type === 'expense_created' && e.payload.after.amount === 2000)).toBe(true);
    again.close();
  });

  it('неизвестный Last-Event-ID — команда перезагрузить данные целиком', async () => {
    const { anya } = await setup();
    const s = await connect(anya, '00000000-0000-4000-8000-000000000000');
    await until(() => s.has('resync'));
    s.close();
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
    v.close();
  });
});
