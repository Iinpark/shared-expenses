import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '../src/db/client.js';
import { groups, invites } from '../src/db/schema.js';
import { must, type InvitePreviewDto } from '@se/shared';
import { emailsTo, errorOf, groupOf, groupsOf, lastEmailTo, login, makeApp, resetDb, tokenFromUrl } from './helpers.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

type Cookie = string;
const get = (cookie: Cookie | null, url: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const post = (cookie: Cookie, url: string, payload?: object) => app.inject({ method: 'POST', url, headers: { cookie }, payload });

async function createKazan(anya: Cookie, inviteEmails: string[] = []) {
  const res = await post(anya, '/api/groups', { name: 'Поездка в Казань', currency: 'RUB', reminderDays: 7, inviteEmails });
  expect(res.statusCode).toBe(201);
  return groupOf(res);
}

describe('группы', () => {
  it('создатель становится первым участником, у группы сразу есть ссылка-приглашение', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня', 'f');
    const group = await createKazan(anya);
    expect(group).toMatchObject({ name: 'Поездка в Казань', currency: 'RUB', reminderDays: 7, status: 'open', memberCount: 1 });
    expect(group.members).toEqual([expect.objectContaining({ name: 'Аня', joinOrder: 1, isOwner: true })]);
    expect(group.inviteToken).toMatch(/^[A-Za-z0-9]{10}$/);

    const list = groupsOf(await get(anya, '/api/groups'));
    expect(list).toHaveLength(1);
    expect(must(list[0]).memberNames).toEqual(['Аня']);
  });

  it('приглашение по почте: одно письмо на адрес, повторное приглашение не дублирует', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня', 'f');
    const group = await createKazan(anya, ['boris@example.com', 'vika@example.com', 'boris@example.com']);
    expect(group.pendingInvites.map((i) => i.email)).toEqual(['boris@example.com', 'vika@example.com']);

    const mail = must(await lastEmailTo('boris@example.com'));
    expect(mail.subject).toBe('Аня зовёт тебя в группу «Поездка в Казань»');
    expect(mail.html).toContain('указала твой адрес');
    expect(tokenFromUrl(mail.text)).toBeTruthy();

    await post(anya, `/api/groups/${group.id}/invites`, { emails: ['boris@example.com'] });
    expect(await emailsTo('boris@example.com', 'зовёт тебя')).toHaveLength(1);
  });

  it('чужая группа не видна даже по id', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const stranger = await login(app, 'x@example.com', 'Икс');
    const group = await createKazan(anya);
    expect((await get(stranger, `/api/groups/${group.id}`)).statusCode).toBe(404);
    expect((await get(stranger, '/api/groups')).json()).toEqual([]);
  });

  it('менять настройки может только создатель', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const boris = await login(app, 'boris@example.com', 'Борис');
    const group = await createKazan(anya);
    await post(boris, `/api/invites/${group.inviteToken}/accept`);

    const patch = (cookie: Cookie, payload: object) =>
      app.inject({ method: 'PATCH', url: `/api/groups/${group.id}`, headers: { cookie }, payload });
    expect((await patch(boris, { name: 'Взлом' })).statusCode).toBe(403);
    const ok = await patch(anya, { name: 'Казань', reminderDays: 10, currency: 'KZT' });
    expect(ok.json()).toMatchObject({ name: 'Казань', reminderDays: 10, currency: 'KZT' });
    expect((await patch(anya, { reminderDays: 0 })).statusCode).toBe(400);
  });
});

describe('приглашения', () => {
  it('превью видно без входа, вступление по ссылке добавляет участника вторым', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня', 'f');
    const group = await createKazan(anya);

    const preview = (await get(null, `/api/invites/${group.inviteToken}`)).json<InvitePreviewDto>();
    expect(preview).toMatchObject({ status: 'valid', groupName: 'Поездка в Казань', inviterName: 'Аня', memberNames: ['Аня'], alreadyMember: false });

    const boris = await login(app, 'boris@example.com', 'Борис');
    const accepted = await post(boris, `/api/invites/${group.inviteToken}/accept`);
    expect(accepted.json()).toEqual({ groupId: group.id });

    const full = groupOf(await get(anya, `/api/groups/${group.id}`));
    expect(full.members.map((m) => [m.name, m.joinOrder])).toEqual([
      ['Аня', 1],
      ['Борис', 2],
    ]);
    expect((await get(boris, `/api/invites/${group.inviteToken}`)).json()).toMatchObject({ alreadyMember: true });
  });

  it('повторное вступление ничего не ломает', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya);
    const boris = await login(app, 'boris@example.com', 'Борис');
    await post(boris, `/api/invites/${group.inviteToken}/accept`);
    await post(boris, `/api/invites/${group.inviteToken}/accept`);
    expect(groupOf(await get(anya, `/api/groups/${group.id}`)).memberCount).toBe(2);
  });

  it('вступление по письму закрывает приглашение на этот адрес', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya, ['vika@example.com']);
    const token = must(tokenFromUrl(must(await lastEmailTo('vika@example.com')).text));
    const vika = await login(app, 'vika@example.com', 'Вика');
    expect((await post(vika, `/api/invites/${token}/accept`)).statusCode).toBe(200);
    expect(groupOf(await get(anya, `/api/groups/${group.id}`)).pendingInvites).toEqual([]);
  });

  it('после обновления ссылки старая не работает', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня', 'f');
    const group = await createKazan(anya);
    const rotated = groupOf(await post(anya, `/api/groups/${group.id}/invite-link/rotate`));
    expect(rotated.inviteToken).not.toBe(group.inviteToken);

    expect((await get(null, `/api/invites/${group.inviteToken}`)).json()).toMatchObject({ status: 'expired', reason: 'rotated', inviterName: 'Аня', inviterGender: 'f' });
    const gena = await login(app, 'gena@example.com', 'Гена');
    expect((await post(gena, `/api/invites/${group.inviteToken}/accept`)).statusCode).toBe(409);
    expect((await post(gena, `/api/invites/${rotated.inviteToken}/accept`)).statusCode).toBe(200);
  });

  it('пять одновременных вступлений получают разные места в порядке группы', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya);
    const cookies = await Promise.all(['b', 'c', 'd', 'e', 'f'].map((n) => login(app, `${n}@example.com`, n.toUpperCase())));
    const results = await Promise.all(cookies.map((c) => post(c, `/api/invites/${group.inviteToken}/accept`)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const orders = groupOf(await get(anya, `/api/groups/${group.id}`)).members.map((m) => m.joinOrder);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('в закрытую группу не вступить и не позвать', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya);
    await db.update(groups).set({ status: 'closed', closedAt: new Date() }).where(eq(groups.id, group.id));
    expect((await get(null, `/api/invites/${group.inviteToken}`)).json()).toMatchObject({ status: 'expired', reason: 'closed' });
    expect((await post(anya, `/api/groups/${group.id}/invites`, { emails: ['z@example.com'] })).statusCode).toBe(409);
  });

  it('несуществующая ссылка — 404', async () => {
    expect((await get(null, '/api/invites/nope')).statusCode).toBe(404);
  });

  it('приглашение по почте, которое истекло, можно отправить заново', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya, ['vika@example.com']);
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.email, 'vika@example.com'));
    const again = groupOf(await post(anya, `/api/groups/${group.id}/invites`, { emails: ['vika@example.com'] }));
    expect(again.pendingInvites.map((i) => i.email)).toEqual(['vika@example.com']);
    expect(await emailsTo('vika@example.com', 'зовёт тебя')).toHaveLength(2);
  });

  it('пересланное приглашение не закрывает приглашение адресата, а после его вступления не работает', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya, ['vika@example.com']);
    const token = must(tokenFromUrl(must(await lastEmailTo('vika@example.com')).text));

    const gena = await login(app, 'gena@example.com', 'Гена');
    expect((await post(gena, `/api/invites/${token}/accept`)).statusCode).toBe(200);
    expect(groupOf(await get(anya, `/api/groups/${group.id}`)).pendingInvites).toHaveLength(1);

    const vika = await login(app, 'vika@example.com', 'Вика');
    expect((await post(vika, `/api/invites/${token}/accept`)).statusCode).toBe(200);
    expect(groupOf(await get(anya, `/api/groups/${group.id}`)).pendingInvites).toHaveLength(0);

    const boris = await login(app, 'boris@example.com', 'Борис');
    expect((await post(boris, `/api/invites/${token}/accept`)).statusCode).toBe(409);
    expect((await get(null, `/api/invites/${token}`)).json()).toMatchObject({ status: 'expired' });
  });

  it('за сутки можно разослать не больше 100 приглашений', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya);
    const batch = (from: number) => Array.from({ length: 30 }, (_, i) => `p${from + i}@example.com`);
    for (let i = 0; i < 3; i++) expect((await post(anya, `/api/groups/${group.id}/invites`, { emails: batch(i * 30) })).statusCode).toBe(200);
    const res = await post(anya, `/api/groups/${group.id}/invites`, { emails: batch(90) });
    expect(res.statusCode).toBe(429);
  });

  it('пустое изменение настроек — понятная ошибка, а не 500', async () => {
    const anya = await login(app, 'anya@example.com', 'Аня');
    const group = await createKazan(anya);
    const res = await app.inject({ method: 'PATCH', url: `/api/groups/${group.id}`, headers: { cookie: anya }, payload: {} });
    expect(res.statusCode).toBe(400);
    const zero = await app.inject({ method: 'PATCH', url: `/api/groups/${group.id}`, headers: { cookie: anya }, payload: { reminderDays: 0 } });
    expect(errorOf(zero).message).toBe('От 1 до 90 дней');
  });
});
