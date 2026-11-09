import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from '../vitest.config.js';

/** Уведомления Postgres вроде «база не существует, пропускаем» в тестах не нужны. */
const ignoreNotice = (): undefined => undefined;

/** Пересоздаёт тестовую базу и применяет миграции перед запуском тестов. */
export default async function setup() {
  const adminUrl = TEST_DATABASE_URL.replace(/\/[^/]+$/, '/postgres');
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const admin = postgres(adminUrl, { max: 1, onnotice: ignoreNotice });
  try {
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: ignoreNotice });
  try {
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await client.end();
  }
}
