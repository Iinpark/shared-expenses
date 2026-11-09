import { must, type BalancesDto, type ExpenseDto, type SplitInput } from '@se/shared';
import { KAZAN_EXPENSES, KAZAN_MEMBERS, type KazanMember } from '@se/shared/fixtures/kazan';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { balancesOf as parseBalances, expenseOf, groupOf, login } from './helpers.js';

/** Контрольный пример «Поездка в Казань» через API: группа, участники, расходы из фикстуры. */
export function kazanKit(app: FastifyInstance) {
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

  return { req, NAMES, kazan, splitFor, input, addAll, balancesOf, byName };
}

export type Cookie = string;
export type Ids = Record<KazanMember, string>;
