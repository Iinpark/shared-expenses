import { buildApp } from './app.js';
import { config } from './config.js';
import { db, sql } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { smtpSender, startOutboxWorker } from './mail/outbox.js';
import { startReminderWorker } from './reminders/service.js';

await runMigrations(db);

const app = await buildApp({ logger: true });
const stopOutbox = startOutboxWorker(db, smtpSender(), app.log);
const stopReminders = startReminderWorker(db, app.log, config.reminderIntervalMs);

const shutdown = async () => {
  stopOutbox();
  stopReminders();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port: config.port, host: '0.0.0.0' });
