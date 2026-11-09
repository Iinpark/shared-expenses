// Пересоздаёт базу для e2e перед стартом сервера (Playwright запускает webServer раньше globalSetup).
// Запускается как `node --experimental-strip-types e2e/prepare-db.ts`, поэтому без импортов из проекта.
import postgres from 'postgres';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://app:app@localhost:5433/shared_expenses_e2e';
const dbName = new URL(url).pathname.slice(1);
const admin = postgres(url.replace(/\/[^/]+$/, '/postgres'), { max: 1, onnotice: () => undefined });
try {
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
  await admin.unsafe(`create database "${dbName}"`);
} finally {
  await admin.end();
}
