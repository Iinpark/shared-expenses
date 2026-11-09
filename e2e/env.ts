/** Отдельные порты и база, чтобы e2e не мешали dev-серверу и тестам сервера. */
export const E2E = {
  apiPort: 3100,
  webPort: 5273,
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgres://app:app@localhost:5433/shared_expenses_e2e',
};
export const WEB_URL = `http://localhost:${String(E2E.webPort)}`;
