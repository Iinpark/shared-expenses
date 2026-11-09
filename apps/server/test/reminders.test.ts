import { must } from '@se/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '../src/db/client.js';
import { groupMembers, groups } from '../src/db/schema.js';
import { runReminders } from '../src/reminders/service.js';
import { emailsTo, makeApp, resetDb } from './helpers.js';
import { kazanKit } from './kazan.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

const { req, kazan, addAll } = kazanKit(app);
const DAY = 86_400_000;
const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);
const reminders = (to: string) => emailsTo(to, 'с тебя');

/** Группа из брифа с четырьмя расходами; первая проверка отмечает, кто с какого момента в минусе. */
async function setup() {
  const kit = await kazan();
  await addAll(kit.groupId, kit.cookies, kit.ids);
  const start = new Date();
  await runReminders(db, start);
  return { ...kit, start };
}

describe('напоминания должникам', () => {
  it('письмо приходит, когда долг висит дольше срока группы: сумма, кому и сколько', async () => {
    const { start } = await setup();
    expect(await runReminders(db, at(start, 6))).toBe(0); // срок группы 7 дней

    expect(await runReminders(db, at(start, 7.1))).toBe(3); // Борис, Вика, Гена
    const [mail] = await reminders('gena@example.com');
    expect(must(mail).subject).toBe('Поездка в Казань: с тебя 3 133,33 ₽');
    expect(must(mail).text).toContain('Гена, пользуясь случаем, напоминаем про расчёт в группе «Поездка в Казань». Прошло уже больше 7 дней.');
    expect(must(mail).text).toContain('Аня: 3 133,33 ₽');
    expect(await reminders('anya@example.com')).toHaveLength(0); // ей вернут, напоминать нечего
  });

  it('не чаще раза в неделю', async () => {
    const { start } = await setup();
    await runReminders(db, at(start, 8));
    expect(await runReminders(db, at(start, 9))).toBe(0);
    expect(await runReminders(db, at(start, 14.9))).toBe(0);
    expect(await runReminders(db, at(start, 15.1))).toBe(3);
    expect(await reminders('gena@example.com')).toHaveLength(2);
  });

  it('не приходит, если долг погашен, и не приходит, пока ждёт подтверждения погашение на всю сумму', async () => {
    const { groupId, cookies, ids, start } = await setup();
    // Борис погасил всё, Аня подтвердила.
    const boris = (await req('POST', cookies.boris, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 423_334 })).json<{ id: string }>();
    await req('POST', cookies.anya, `/api/settlements/${boris.id}/confirm`);
    // Гена отметил весь долг, Аня ещё не подтвердила.
    await req('POST', cookies.gena, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 313_333 });
    // Вика отметила только часть — ей напоминание всё равно нужно.
    await req('POST', cookies.vika, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 1_000 });

    expect(await runReminders(db, at(start, 8))).toBe(1);
    expect(await reminders('boris@example.com')).toHaveLength(0);
    expect(await reminders('gena@example.com')).toHaveLength(0);
    const [vika] = await reminders('vika@example.com');
    expect(must(vika).text).toContain('ещё ждёт подтверждения');
  });

  it('погасил долг — отметка «в минусе с» снимается и срок потом считается заново', async () => {
    const { groupId, cookies, ids } = await setup();
    const row = async () =>
      must((await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, ids.boris))))[0]);
    expect((await row()).debtSince).not.toBeNull();

    const s = (await req('POST', cookies.boris, `/api/groups/${groupId}/settlements`, { toId: ids.anya, amount: 423_334 })).json<{ id: string }>();
    await req('POST', cookies.anya, `/api/settlements/${s.id}/confirm`);
    await runReminders(db);
    expect((await row()).debtSince).toBeNull();
  });

  it('в закрытой группе не напоминаем', async () => {
    const { groupId, start } = await setup();
    await db.update(groups).set({ status: 'closed', closedAt: new Date() }).where(eq(groups.id, groupId));
    expect(await runReminders(db, at(start, 30))).toBe(0);
  });
});
