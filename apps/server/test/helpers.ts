import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { emailOutbox } from '../src/db/schema.js';

export async function makeApp() {
  return buildApp();
}

/** Чистит все таблицы между тестами. */
export async function resetDb() {
  await db.execute(
    dsql`truncate table email_outbox, invites, group_members, groups, sessions, login_codes, users restart identity cascade`,
  );
}

/** Последнее письмо на адрес (из очереди, без отправки). */
export async function lastEmailTo(to: string) {
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.to, to)).orderBy(desc(emailOutbox.createdAt)).limit(1);
  return row;
}

export async function emailsTo(to: string, subjectLike?: string) {
  const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.to, to));
  return subjectLike ? rows.filter((r) => r.subject.includes(subjectLike)) : rows;
}

export async function requestCode(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email } });
  if (res.statusCode !== 204) throw new Error(`request-code ${res.statusCode}: ${res.body}`);
  const mail = await lastEmailTo(email.toLowerCase());
  const code = mail?.subject.match(/(\d{6})/)?.[1];
  if (!code) throw new Error('no code in email');
  return code;
}

/** Полный вход по коду и (по желанию) знакомство. Возвращает заголовок Cookie. */
export async function login(app: FastifyInstance, email: string, name: string | null = email.split('@')[0]!, gender: 'f' | 'm' | null = null) {
  const code = await requestCode(app, email);
  const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { email, code } });
  if (res.statusCode !== 200) throw new Error(`verify ${res.statusCode}: ${res.body}`);
  const sid = res.cookies.find((c) => c.name === 'sid')?.value;
  const cookie = `sid=${sid}`;
  if (name) {
    const p = await app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie }, payload: { name, gender } });
    if (p.statusCode !== 200) throw new Error(`profile ${p.statusCode}: ${p.body}`);
  }
  return cookie;
}

export const tokenFromUrl = (text: string) => text.match(/\/j\/([A-Za-z0-9]+)/)?.[1];

export { and, eq };
