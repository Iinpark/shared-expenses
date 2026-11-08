import { and, asc, eq, isNull, lte, sql as dsql } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import type { Db, Tx } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';
import type { EmailMessage } from './templates.js';

/**
 * Кладёт письмо в очередь в той же транзакции, что и событие.
 * Повторный вызов с тем же ключом ничего не делает: одно событие — одно письмо.
 */
export async function enqueueEmail(tx: Tx, dedupeKey: string, msg: EmailMessage) {
  await tx
    .insert(emailOutbox)
    .values({ dedupeKey, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey });
}

export type SendMail = (msg: EmailMessage) => Promise<void>;

export function smtpSender(transport: Transporter = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: false })): SendMail {
  return async (msg) => {
    await transport.sendMail({ from: config.smtp.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
  };
}

const MAX_ATTEMPTS = 8;

/**
 * Отправляет порцию писем из очереди. Строки блокируются через FOR UPDATE SKIP LOCKED,
 * поэтому два воркера не отправят одно письмо дважды. Ошибка — повтор с растущей паузой.
 */
export async function processOutbox(db: Db, send: SendMail, batch = 20): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(emailOutbox)
      .where(and(isNull(emailOutbox.sentAt), lte(emailOutbox.nextAttemptAt, new Date()), lte(emailOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(emailOutbox.createdAt))
      .limit(batch)
      .for('update', { skipLocked: true });

    for (const row of rows) {
      try {
        await send({ to: row.to, subject: row.subject, html: row.html, text: row.text });
        await tx.update(emailOutbox).set({ sentAt: new Date(), attempts: row.attempts + 1, lastError: null }).where(eq(emailOutbox.id, row.id));
      } catch (err) {
        const delaySec = Math.min(2 ** row.attempts * 5, 3600);
        await tx
          .update(emailOutbox)
          .set({
            attempts: row.attempts + 1,
            lastError: String(err),
            nextAttemptAt: dsql`now() + make_interval(secs => ${delaySec})`,
          })
          .where(eq(emailOutbox.id, row.id));
      }
    }
    return rows.length;
  });
}

/** Фоновый цикл отправки. Возвращает функцию остановки. */
export function startOutboxWorker(db: Db, send: SendMail, log: { error: (o: unknown, m?: string) => void }, intervalMs = 1500) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    try {
      // Пока очередь не пуста, отправляем порциями без паузы.
      while (!stopped && (await processOutbox(db, send)) > 0) {}
    } catch (err) {
      log.error(err, 'outbox worker failed');
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
