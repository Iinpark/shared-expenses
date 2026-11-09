import { must, type GroupDto, type GroupReportDto } from '@se/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/db/client.js';
import { emailsTo, errorOf, login, makeApp, resetDb } from './helpers.js';
import { kazanKit } from './kazan.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

const { req, kazan, addAll, input } = kazanKit(app);
const reportOf = (res: { json: () => unknown }) => res.json() as GroupReportDto;

describe('итоговый отчёт', () => {
  it('сверка сходится: заплатили = доли = потрачено, итоги в сумме 0, погашения учтены', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);
    const s = (await req('POST', cookies.boris, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 423_334 })).json<{ id: string }>();
    await req('POST', cookies.anya, `/api/settlements/${s.id}/confirm`);
    await req('POST', cookies.gena, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 200_000 });

    const r = reportOf(await req('GET', cookies.vika, `/api/groups/${groupId}/report`));
    expect(r.totalSpent).toBe(1_965_000);
    expect(r.members.reduce((x, m) => x + m.share, 0)).toBe(r.totalSpent);
    expect(r.members.reduce((x, m) => x + m.balance, 0)).toBe(0);
    const boris = must(r.members.find((m) => m.userId === ids.boris));
    expect(boris).toMatchObject({ paid: 100_000, share: 523_334, settled: 423_334, balance: 0 });
    expect(r.settlements.map((x) => x.status).sort()).toEqual(['confirmed', 'pending']);
    expect(r.transfers).toHaveLength(2); // Гена и Вика ещё не рассчитались
    expect(r.period).toEqual({ from: '2026-10-16', to: '2026-10-16' });
  });
});

describe('закрытие группы', () => {
  it('закрывает только создатель; всем участникам письмо с итогом; расходы больше не добавить', async () => {
    const { groupId, cookies, ids } = await kazan();
    await addAll(groupId, cookies, ids);

    expect((await req('POST', cookies.boris, `/api/groups/${groupId}/close`)).statusCode).toBe(403);
    const closed = await req('POST', cookies.anya, `/api/groups/${groupId}/close`);
    expect(closed.statusCode).toBe(200);
    expect(closed.json<GroupDto>().status).toBe('closed');

    for (const m of ['anya', 'boris', 'vika', 'gena']) {
      const mails = await emailsTo(`${m}@example.com`, 'закрыта: итог');
      expect(mails).toHaveLength(1);
      expect(must(mails[0]).text).toContain('Аня закрыл(а) группу');
      expect(must(mails[0]).text).toContain('Потрачено вместе: 19 650,00 ₽');
      expect(must(mails[0]).text).toContain(`/groups/${groupId}/report`);
    }
    expect(errorOf(await req('POST', cookies.boris, `/api/groups/${groupId}/expenses`, input(ids, 0))).code).toBe('group_closed');
    expect((await req('POST', cookies.anya, `/api/groups/${groupId}/close`)).statusCode).toBe(409);
  });

  it('группу можно открыть снова, поправить расход и закрыть — придёт новое письмо с новым итогом', async () => {
    const { groupId, cookies, ids } = await kazan();
    const [, taxi] = await addAll(groupId, cookies, ids);
    await req('POST', cookies.anya, `/api/groups/${groupId}/close`);

    expect((await req('POST', cookies.vika, `/api/groups/${groupId}/reopen`)).statusCode).toBe(403);
    expect((await req('POST', cookies.anya, `/api/groups/${groupId}/reopen`)).json<GroupDto>().status).toBe('open');
    await req('PUT', cookies.boris, `/api/expenses/${must(taxi).id}`, input(ids, 1, { amount: 120_000, version: 1 }));
    await req('POST', cookies.anya, `/api/groups/${groupId}/close`);

    const mails = await emailsTo('gena@example.com', 'закрыта: итог');
    expect(mails).toHaveLength(2);
    expect(mails.map((m) => m.text).some((t) => t.includes('Потрачено вместе: 19 850,00 ₽'))).toBe(true);
  });

  it('чужой отчёт не видит', async () => {
    const { groupId } = await kazan();
    const stranger = await login(app, 'x@example.com', 'Икс');
    expect((await req('GET', stranger, `/api/groups/${groupId}/report`)).statusCode).toBe(404);
  });
});
