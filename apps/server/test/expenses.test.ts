import { must, type BalancesDto, type ExpenseDto, type SplitInput } from '@se/shared';
import { KAZAN_BALANCES_AFTER_EXPENSES, KAZAN_EXPENSES, KAZAN_MEMBERS, type KazanMember } from '@se/shared/fixtures/kazan';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '../src/db/client.js';
import { groups } from '../src/db/schema.js';
import { balancesOf as parseBalances, conflictOf, errorOf, expenseOf, expensesOf, groupOf, groupsOf, login, makeApp, meOf, resetDb } from './helpers.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

type Cookie = string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', cookie: Cookie, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });

const NAMES: Record<KazanMember, string> = { anya: 'Аня', boris: 'Борис', vika: 'Вика', gena: 'Гена' };

/** Группа «Поездка в Казань»: Аня создаёт, остальные вступают по ссылке в порядке Борис, Вика, Гена. */
async function kazan() {
  const cookies = {} as Record<KazanMember, Cookie>;
  const ids = {} as Record<KazanMember, string>;
  for (const m of KAZAN_MEMBERS) cookies[m] = await login(app, `${m}@example.com`, NAMES[m]);
  const group = groupOf(await req('POST', cookies.anya, '/api/groups', { name: 'Поездка в Казань', currency: 'RUB', reminderDays: 7 }));
  for (const m of KAZAN_MEMBERS.slice(1)) await req('POST', cookies[m], `/api/invites/${group.inviteToken}/accept`);
  const full = groupOf(await req('GET', cookies.anya, `/api/groups/${group.id}`));
  for (const member of full.members) ids[must(KAZAN_MEMBERS.find((m) => NAMES[m] === member.name))] = member.userId;
  return { groupId: group.id, cookies, ids };
}

type Ids = Record<KazanMember, string>;

/** Переводит деление из фикстуры (имена) в запрос API (id пользователей). */
function splitFor(split: SplitInput, ids: Ids): SplitInput {
  const id = (name: string) => ids[name as KazanMember];
  if (split.mode === 'equal') return { mode: 'equal', userIds: split.userIds.map(id) };
  if (split.mode === 'shares') return { mode: 'shares', shares: split.shares.map((s) => ({ ...s, userId: id(s.userId) })) };
  return { mode: 'exact', shares: split.shares.map((s) => ({ ...s, userId: id(s.userId) })) };
}

const input = (ids: Ids, i: number, patch: object = {}) => {
  const e = must(KAZAN_EXPENSES[i]);
  return { amount: e.amount, title: e.title, category: 'other', payerId: ids[e.payer], spentOn: '2026-10-16', split: splitFor(e.split, ids), ...patch };
};

async function addAll(groupId: string, cookies: Record<KazanMember, Cookie>, ids: Ids): Promise<ExpenseDto[]> {
  const out: ExpenseDto[] = [];
  for (let i = 0; i < KAZAN_EXPENSES.length; i++) {
    const res = await req('POST', cookies[must(KAZAN_EXPENSES[i]).payer], `/api/groups/${groupId}/expenses`, input(ids, i));
    expect(res.statusCode, res.body).toBe(201);
    out.push(expenseOf(res));
  }
  return out;
}

const balancesOf = async (cookie: Cookie, groupId: string) => parseBalances(await req('GET', cookie, `/api/groups/${groupId}/balances`));
const byName = (b: BalancesDto, ids: Ids) =>
  Object.fromEntries(b.balances.map((x) => [must(KAZAN_MEMBERS.find((m) => ids[m] === x.userId)), x.amount]));

describe('расходы и балансы', () => {
  it('«Поездка в Казань»: четыре расхода дают балансы и три перевода из брифа', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);

    expect(must(taxi).shares).toEqual([
      { userId: ids.boris, amount: 33_334, weight: 1 },
      { userId: ids.vika, amount: 33_333, weight: 1 },
      { userId: ids.gena, amount: 33_333, weight: 1 },
    ]);

    const b = await balancesOf(cookies.vika, groupId);
    expect(byName(b, ids)).toEqual(KAZAN_BALANCES_AFTER_EXPENSES);
    expect(b.totalSpent).toBe(1_965_000);
    expect(b.expenseCount).toBe(4);
    expect(b.transfers).toEqual([
      { fromId: ids.boris, toId: ids.anya, amount: 423_334 },
      { fromId: ids.gena, toId: ids.anya, amount: 313_333 },
      { fromId: ids.vika, toId: ids.anya, amount: 3_333 },
    ]);

    const list = groupsOf(await req('GET', cookies.anya, '/api/groups'));
    expect(must(list[0]).myBalance).toBe(740_000);
    const group = groupOf(await req('GET', cookies.gena, `/api/groups/${groupId}`));
    expect(group.myBalance).toBe(-313_333);
  });

  it('правка старого расхода пересчитывает балансы, версия растёт', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;
    const res = await req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 120_000, version: 1 }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, amount: 120_000, updatedBy: ids.boris });
    expect(expenseOf(res).shares.map((s) => s.amount)).toEqual([40_000, 40_000, 40_000]);
    // Без погашения Бориса: такси стало дороже на 200, Борис заплатил больше, а его доля выросла на 66,66.
    expect(byName(await balancesOf(cookies.anya, groupId), ids)).toEqual({ anya: 740_000, boris: -410_000, vika: -10_000, gena: -320_000 });
  });

  it('удаление убирает расход из балансов и списка', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [flat] = await addAll(groupId, cookies, ids);
    const flatId = must(flat).id;
    expect((await req('DELETE', cookies.anya, `/api/expenses/${flatId}?version=1`)).statusCode).toBe(204);
    const list = expensesOf(await req('GET', cookies.anya, `/api/groups/${groupId}/expenses`));
    expect(list).toHaveLength(3);
    expect((await req('GET', cookies.anya, `/api/expenses/${flatId}`)).statusCode).toBe(404);
    const b = await balancesOf(cookies.anya, groupId);
    expect(b.balances.reduce((s, x) => s + x.amount, 0)).toBe(0);
    expect(byName(b, ids).anya).toBe(-160_000);
  });

  it('список: сначала новые по дате траты', async () => {
    const { groupId, cookies, ids } = await kazan();
    await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0, { spentOn: '2026-10-16' }));
    await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 3, { spentOn: '2026-10-18' }));
    await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 2, { spentOn: '2026-10-17' }));
    const list = expensesOf(await req('GET', cookies.anya, `/api/groups/${groupId}/expenses`));
    expect(list.map((e) => e.spentOn)).toEqual(['2026-10-18', '2026-10-17', '2026-10-16']);
  });

  it('после первого расхода валюту группы не поменять', async () => {
    const { groupId, cookies, ids } = await kazan();
    expect(groupOf(await req('GET', cookies.anya, `/api/groups/${groupId}`)).currencyLocked).toBe(false);
    await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0));
    expect(groupOf(await req('GET', cookies.anya, `/api/groups/${groupId}`)).currencyLocked).toBe(true);
    const res = await req('PATCH', cookies.anya, `/api/groups/${groupId}`, { currency: 'USD' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('currency_locked');
  });
});

describe('проверки при сохранении', () => {
  it('точные суммы не сходятся на 150,00 — 400', async () => {
    const { groupId, cookies, ids } = await kazan();
    const split = splitFor(must(KAZAN_EXPENSES[2]).split, ids);
    if (split.mode !== 'exact') throw new Error('ужин делится точными суммами');
    must(split.shares[3]).amount = 85_000;
    const res = await req('POST', cookies.vika, `/api/groups/${groupId}/expenses`, input(ids, 2, { split }));
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).message).toContain('до копейки');
  });

  it('делить можно только между участниками, платить — только участнику', async () => {
    const { groupId, cookies, ids } = await kazan();
    const stranger = await login(app, 'x@example.com', 'Икс');
    const strangerId = meOf(await req('GET', stranger, '/api/me')).id;

    const badSplit = await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0, { split: { mode: 'equal', userIds: [ids.anya, strangerId] } }));
    expect(badSplit.statusCode).toBe(400);
    const badPayer = await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0, { payerId: strangerId }));
    expect(badPayer.statusCode).toBe(400);
  });

  it('нулевая и дробная сумма не принимаются', async () => {
    const { groupId, cookies, ids } = await kazan();
    expect((await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0, { amount: 0 }))).statusCode).toBe(400);
    expect((await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0, { amount: 10.5 }))).statusCode).toBe(400);
  });

  it('чужой не видит и не трогает расходы группы', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [flat] = await addAll(groupId, cookies, ids);
    const flatId = must(flat).id;
    const stranger = await login(app, 'x@example.com', 'Икс');
    expect((await req('GET', stranger, `/api/groups/${groupId}/expenses`)).statusCode).toBe(404);
    expect((await req('GET', stranger, `/api/groups/${groupId}/balances`)).statusCode).toBe(404);
    expect((await req('GET', stranger, `/api/expenses/${flatId}`)).statusCode).toBe(404);
    expect((await req('PUT', stranger, `/api/expenses/${flatId}`, input(ids, 0, { version: 1 }))).statusCode).toBe(404);
    expect((await req('DELETE', stranger, `/api/expenses/${flatId}?version=1`)).statusCode).toBe(404);
    expect((await req('POST', stranger, `/api/groups/${groupId}/expenses`, input(ids, 0))).statusCode).toBe(404);
  });

  it('в закрытой группе расходы не добавить, не изменить и не удалить', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [flat] = await addAll(groupId, cookies, ids);
    const flatId = must(flat).id;
    await db.update(groups).set({ status: 'closed', closedAt: new Date() }).where(eq(groups.id, groupId));
    const codes = [
      await req('POST', cookies.anya, `/api/groups/${groupId}/expenses`, input(ids, 0)),
      await req('PUT', cookies.anya, `/api/expenses/${flatId}`, input(ids, 0, { version: 1 })),
      await req('DELETE', cookies.anya, `/api/expenses/${flatId}?version=1`),
    ].map((r) => errorOf(r).code);
    expect(codes).toEqual(['group_closed', 'group_closed', 'group_closed']);
  });
});

describe('конфликт правок', () => {
  it('правка со старой версией — 409 и текущая версия в ответе', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;
    await req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 120_000, version: 1 }));

    const stale = await req('PUT', cookies.anya, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 90_000, version: 1 }));
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe('version_conflict');
    expect(conflictOf(stale).current).toMatchObject({ id: taxiId, version: 2, amount: 120_000 });
    // Правка Вики не записалась.
    expect(expenseOf(await req('GET', cookies.anya, `/api/expenses/${taxiId}`)).amount).toBe(120_000);
  });

  it('две одновременные правки одной версии: проходит ровно одна', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;
    const results = await Promise.all([
      req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 120_000, version: 1 })),
      req('PUT', cookies.anya, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 90_000, version: 1 })),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const final = expenseOf(await req('GET', cookies.anya, `/api/expenses/${taxiId}`));
    expect(final.version).toBe(2);
    expect(final.shares.reduce((s, x) => s + x.amount, 0)).toBe(final.amount);
  });

  it('удаление устаревшей версии — 409; удалённый расход больше не найти', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;
    await req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 120_000, version: 1 }));
    expect((await req('DELETE', cookies.anya, `/api/expenses/${taxiId}?version=1`)).statusCode).toBe(409);

    expect((await req('DELETE', cookies.anya, `/api/expenses/${taxiId}?version=2`)).statusCode).toBe(204);
    // Борис правит из открытой формы уже удалённый расход.
    const res = await req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { version: 2 }));
    expect(res.statusCode).toBe(404);
  });
});

describe('кто может менять расход', () => {
  it('чужой участник не может изменить или удалить расход: 403, расход не тронут', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;

    const put = await req('PUT', cookies.vika, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 1, version: 1 }));
    expect(put.statusCode).toBe(403);
    expect(errorOf(put).code).toBe('forbidden');
    expect((await req('DELETE', cookies.vika, `/api/expenses/${taxiId}?version=1`)).statusCode).toBe(403);
    expect(expenseOf(await req('GET', cookies.vika, `/api/expenses/${taxiId}`))).toMatchObject({ amount: 100_000, version: 1 });
  });

  it('плательщик и создатель группы могут менять расход', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    const taxiId = must(taxi).id;
    expect((await req('PUT', cookies.boris, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 120_000, version: 1 }))).statusCode).toBe(200);
    expect((await req('PUT', cookies.anya, `/api/expenses/${taxiId}`, input(ids, 1, { amount: 110_000, version: 2 }))).statusCode).toBe(200);
  });

  it('если расход внёс не плательщик, менять могут оба, а третий — нет', async () => {
    const { groupId, cookies, ids } = await kazan();
    // Вика вносит музей, который оплатил Гена.
    const created = expenseOf(await req('POST', cookies.vika, `/api/groups/${groupId}/expenses`, input(ids, 3)));
    expect(created).toMatchObject({ payerId: ids.gena, createdBy: ids.vika });

    expect((await req('PUT', cookies.vika, `/api/expenses/${created.id}`, input(ids, 3, { amount: 210_000, version: 1 }))).statusCode).toBe(200);
    expect((await req('PUT', cookies.gena, `/api/expenses/${created.id}`, input(ids, 3, { amount: 220_000, version: 2 }))).statusCode).toBe(200);
    expect((await req('PUT', cookies.boris, `/api/expenses/${created.id}`, input(ids, 3, { amount: 1, version: 3 }))).statusCode).toBe(403);
  });
});
