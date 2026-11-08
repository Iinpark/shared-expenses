import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/db/client.js';
import { login, makeApp, requestCode, resetDb } from './helpers.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

const verify = (email: string, code: string) => app.inject({ method: 'POST', url: '/api/auth/verify', payload: { email, code } });

describe('вход по коду из письма', () => {
  it('первый вход создаёт аккаунт без имени, после знакомства пускает к группам', async () => {
    const code = await requestCode(app, 'Anya@Example.com');
    const res = await verify('anya@example.com', code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'anya@example.com', name: null });

    const cookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
    const groupsBefore = await app.inject({ method: 'GET', url: '/api/groups', headers: { cookie } });
    expect(groupsBefore.statusCode).toBe(403);
    expect(groupsBefore.json().error.code).toBe('profile_required');

    await app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie }, payload: { name: 'Аня', gender: 'f' } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ name: 'Аня', gender: 'f' });
    expect((await app.inject({ method: 'GET', url: '/api/groups', headers: { cookie } })).statusCode).toBe(200);
  });

  it('повторный вход попадает в тот же аккаунт', async () => {
    await login(app, 'anya@example.com', 'Аня');
    const cookie = await login(app, 'anya@example.com', null);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().name).toBe('Аня');
  });

  it('неверный код считается попыткой, после пяти код блокируется', async () => {
    const code = await requestCode(app, 'gena@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await verify('gena@example.com', wrong);
      expect(res.json().error.code).toBe('code_invalid');
    }
    const locked = await verify('gena@example.com', code);
    expect(locked.json().error.code).toBe('code_locked');
  });

  it('новый код отменяет старый', async () => {
    const first = await requestCode(app, 'vika@example.com');
    const second = await requestCode(app, 'vika@example.com');
    if (first !== second) expect((await verify('vika@example.com', first)).statusCode).toBe(400);
    expect((await verify('vika@example.com', second)).statusCode).toBe(200);
  });

  it('код одноразовый', async () => {
    const code = await requestCode(app, 'boris@example.com');
    expect((await verify('boris@example.com', code)).statusCode).toBe(200);
    expect((await verify('boris@example.com', code)).json().error.code).toBe('code_expired');
  });

  it('не больше пяти кодов на почту за 15 минут', async () => {
    for (let i = 0; i < 5; i++) await requestCode(app, 'spam@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'spam@example.com' } });
    expect(res.statusCode).toBe(429);
  });

  it('выход закрывает сессию', async () => {
    const cookie = await login(app, 'anya@example.com', 'Аня');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('кривой адрес отклоняется с понятным текстом', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email: 'не почта' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Похоже, в адресе опечатка');
  });
});
