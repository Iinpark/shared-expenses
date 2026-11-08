/** Настройки из окружения. Значения по умолчанию совпадают с docker-compose.yml, поэтому .env не обязателен. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5433/shared_expenses',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
  },
} as const;
