import { must, type SettlementDto } from '@se/shared';
import { KAZAN_BALANCES_AFTER_FIX, KAZAN_TAXI_FIXED_AMOUNT, KAZAN_TRANSFERS_AFTER_FIX } from '@se/shared/fixtures/kazan';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '../src/db/client.js';
import { groups } from '../src/db/schema.js';
import { errorOf, login, makeApp, resetDb } from './helpers.js';
import { kazanKit, type Cookie } from './kazan.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

const { req, kazan, input, addAll, balancesOf, byName } = kazanKit(app);
const settlementOf = (res: { json: () => unknown }) => res.json() as SettlementDto;

const mark = (cookie: Cookie, groupId: string, toId: string, amount: number, comment: string | null = null) =>
  req('POST', cookie, `/api/groups/${groupId}/settlements`, { toId, amount, comment });
const decide = (cookie: Cookie, id: string, action: 'confirm' | 'reject' | 'cancel') => req('POST', cookie, `/api/settlements/${id}/${action}`);

describe('погашения', () => {
  it('«Поездка в Казань»: подтверждённое погашение Бориса учитывается, ожидающее Гены — нет, правка такси разворачивает баланс Бориса', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);

    // Борис отметил весь долг Ане; пока Аня не подтвердила, баланс прежний.
    const boris = settlementOf(await mark(cookies.boris, groupId, ids.anya, 423_334));
    expect(boris.status).toBe('pending');
    expect(byName(await balancesOf(cookies.anya, groupId), ids).boris).toBe(-423_334);
    expect(settlementOf(await decide(cookies.anya, boris.id, 'confirm')).status).toBe('confirmed');
    expect(byName(await balancesOf(cookies.anya, groupId), ids).boris).toBe(0);

    // Гена отметил часть, 2 000 — ожидает и в баланс не идёт.
    const gena = await mark(cookies.gena, groupId, ids.anya, 200_000, 'Перевёл в банке, остальное в пятницу');
    expect(gena.statusCode).toBe(201);

    // Борис исправил такси: 1 000 → 1 200. Его погашение остаётся, баланс разворачивается в плюс.
    const fixed = await req('PUT', cookies.boris, `/api/expenses/${must(taxi).id}`, input(ids, 1, { amount: KAZAN_TAXI_FIXED_AMOUNT, version: 1 }));
    expect(fixed.statusCode).toBe(200);
    const b = await balancesOf(cookies.anya, groupId);
    expect(byName(b, ids)).toEqual(KAZAN_BALANCES_AFTER_FIX);
    expect(b.transfers).toEqual(KAZAN_TRANSFERS_AFTER_FIX.map((t) => ({ fromId: ids[t.from], toId: ids[t.to], amount: t.amount })));
  });

  it('нельзя отметить больше долга с учётом уже отмеченного и не подтверждённого', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    // С Гены 3 133,33.
    expect((await mark(cookies.gena, groupId, ids.anya, 313_334)).statusCode).toBe(409);
    expect((await mark(cookies.gena, groupId, ids.anya, 200_000)).statusCode).toBe(201);
    const over = await mark(cookies.gena, groupId, ids.anya, 113_334);
    expect(over.statusCode).toBe(409);
    expect(errorOf(over).code).toBe('settlement_too_big');
    expect((await mark(cookies.gena, groupId, ids.anya, 113_333)).statusCode).toBe(201);
  });

  it('отмечать можно только тому, кому вернут, и только если с тебя что-то есть', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    // Вика должна, но Борис тоже должен — ему ничего не вернут.
    expect(errorOf(await mark(cookies.vika, groupId, ids.boris, 100)).code).toBe('nothing_to_settle');
    // Аня в плюсе: ей не с чего переводить.
    expect(errorOf(await mark(cookies.anya, groupId, ids.boris, 100)).code).toBe('nothing_to_settle');
    expect((await mark(cookies.gena, groupId, ids.gena, 100)).statusCode).toBe(400);
  });

  it('подтвердить или отклонить может только получатель, отменить — только отметивший; решение одно', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    const s = settlementOf(await mark(cookies.gena, groupId, ids.anya, 200_000));

    expect((await decide(cookies.gena, s.id, 'confirm')).statusCode).toBe(403);
    expect((await decide(cookies.boris, s.id, 'reject')).statusCode).toBe(403);
    expect((await decide(cookies.anya, s.id, 'cancel')).statusCode).toBe(403);

    expect(settlementOf(await decide(cookies.anya, s.id, 'reject')).status).toBe('rejected');
    expect(errorOf(await decide(cookies.anya, s.id, 'confirm')).code).toBe('settlement_decided');
    expect(byName(await balancesOf(cookies.anya, groupId), ids).gena).toBe(-313_333);

    // После отказа можно отметить заново и отменить свою отметку.
    const again = settlementOf(await mark(cookies.gena, groupId, ids.anya, 200_000));
    expect(settlementOf(await decide(cookies.gena, again.id, 'cancel')).status).toBe('cancelled');
  });

  it('два одновременных подтверждения: проходит одно, баланс учтён один раз', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    const s = settlementOf(await mark(cookies.gena, groupId, ids.anya, 200_000));
    const results = await Promise.all([decide(cookies.anya, s.id, 'confirm'), decide(cookies.anya, s.id, 'confirm')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(byName(await balancesOf(cookies.anya, groupId), ids).gena).toBe(-113_333);
  });

  it('список погашений, лента и чужие', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    const s = settlementOf(await mark(cookies.gena, groupId, ids.anya, 200_000));
    await decide(cookies.anya, s.id, 'confirm');

    const list = (await req('GET', cookies.vika, `/api/groups/${groupId}/settlements`)).json<SettlementDto[]>();
    expect(list).toMatchObject([{ id: s.id, status: 'confirmed', amount: 200_000 }]);
    const feed = (await req('GET', cookies.vika, `/api/groups/${groupId}/events?limit=2`)).json<{ events: { payload: { type: string } }[] }>();
    expect(feed.events.map((e) => e.payload.type)).toEqual(['settlement_confirmed', 'settlement_created']);

    const stranger = await login(app, 'x@example.com', 'Икс');
    expect((await req('GET', stranger, `/api/groups/${groupId}/settlements`)).statusCode).toBe(404);
    expect((await decide(stranger, s.id, 'cancel')).statusCode).toBe(404);
  });

  it('в закрытой группе погашения не отметить и не подтвердить', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    const s = settlementOf(await mark(cookies.gena, groupId, ids.anya, 200_000));
    await db.update(groups).set({ status: 'closed', closedAt: new Date() }).where(eq(groups.id, groupId));
    expect(errorOf(await mark(cookies.gena, groupId, ids.anya, 100)).code).toBe('group_closed');
    expect(errorOf(await decide(cookies.anya, s.id, 'confirm')).code).toBe('group_closed');
  });
});
