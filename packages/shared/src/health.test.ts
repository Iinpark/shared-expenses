import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('принимает корректный ответ', () => {
    const parsed = healthResponseSchema.parse({ status: 'ok', db: 'up', time: new Date().toISOString() });
    expect(parsed.db).toBe('up');
  });

  it('отклоняет неизвестный статус', () => {
    expect(() => healthResponseSchema.parse({ status: 'broken', db: 'up', time: '' })).toThrow();
  });
});
