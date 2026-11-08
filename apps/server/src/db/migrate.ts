import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Применяет миграции из apps/server/drizzle. Вызывается при старте сервера и в тестах. */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder });
}
