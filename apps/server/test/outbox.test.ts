import { must } from '@se/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '../src/db/client.js';
import { emailOutbox } from '../src/db/schema.js';
import { enqueueEmail, processOutbox } from '../src/mail/outbox.js';
import type { EmailMessage } from '../src/mail/templates.js';
import { resetDb } from './helpers.js';

afterAll(() => sql.end({ timeout: 5 }));
beforeEach(resetDb);

const msg = (to: string): EmailMessage => ({ to, subject: 'Тема', html: '<p>x</p>', text: 'x' });

describe('очередь писем', () => {
  it('одно событие — одно письмо, даже если поставить его в очередь дважды', async () => {
    await enqueueEmail(db, 'event:1', msg('a@example.com'));
    await enqueueEmail(db, 'event:1', msg('a@example.com'));
    const sent: EmailMessage[] = [];
    const send = (m: EmailMessage) => {
      sent.push(m);
      return Promise.resolve();
    };
    await processOutbox(db, send);
    await processOutbox(db, send);
    expect(sent).toHaveLength(1);
  });

  it('два воркера одновременно не отправляют одно письмо дважды', async () => {
    for (let i = 0; i < 10; i++) await enqueueEmail(db, `event:${i}`, msg(`u${i}@example.com`));
    const sent: string[] = [];
    const send = async (m: EmailMessage) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(m.to);
    };
    await Promise.all([processOutbox(db, send, 10), processOutbox(db, send, 10), processOutbox(db, send, 10)]);
    expect(sent.sort()).toEqual([...new Set(sent)].sort());
    expect(sent).toHaveLength(10);
  });

  it('ошибка отправки откладывает письмо и сохраняет причину', async () => {
    await enqueueEmail(db, 'event:fail', msg('a@example.com'));
    await processOutbox(db, () => Promise.reject(new Error('SMTP недоступен')));
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, 'event:fail'));
    expect(row).toMatchObject({ sentAt: null, attempts: 1 });
    expect(must(row).lastError).toContain('SMTP недоступен');
    expect(must(row).nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
