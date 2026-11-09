import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export const TEST_DATABASE_URL = 'postgres://app:app@localhost:5433/shared_expenses_test';

export default defineConfig({
  test: {
    // Тесты ходят в настоящий Postgres (отдельная база), поэтому файлы идут по очереди.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test', UPLOAD_DIR: join(tmpdir(), 'shared-expenses-test-uploads') },
    testTimeout: 20_000,
  },
});
