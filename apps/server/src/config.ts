import { fileURLToPath } from 'node:url';

/** Настройки из окружения. Значения по умолчанию совпадают с docker-compose.yml, поэтому .env не обязателен. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5433/shared_expenses',
  /** Адрес клиента: для CORS и ссылок в письмах. */
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Секрет для хешей кодов входа. В dev значение по умолчанию, в проде задать обязательно. */
  secret: process.env.APP_SECRET ?? 'dev-secret-change-me',
  /** Как часто проверять, кому пора напомнить о долге. */
  reminderIntervalMs: Number(process.env.REMINDER_INTERVAL_MS ?? 60_000),
  /** Папка для файлов чеков. */
  uploadDir: process.env.UPLOAD_DIR ?? fileURLToPath(new URL('../uploads', import.meta.url)),
  /** Папка собранного клиента. Если задана, сервер раздаёт его сам (так работает образ Docker); в dev клиент отдаёт Vite. */
  webDist: process.env.WEB_DIST,
  isProduction: process.env.NODE_ENV === 'production',
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.SMTP_FROM ?? 'Совместные расходы <no-reply@shared-expenses.local>',
  },
} as const;
