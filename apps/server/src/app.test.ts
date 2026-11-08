import { afterAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@se/shared';
import { buildApp } from './app.js';
import { sql } from './db/client.js';

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});

describe('GET /api/health', () => {
  it('отвечает по контракту и видит базу', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.db).toBe('up');
  });
});
