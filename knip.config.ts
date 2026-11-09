import type { KnipConfig } from 'knip';

/** Мёртвый код: неиспользуемые файлы, экспорты и зависимости. Точки входа knip находит сам по конфигам Vite/Vitest/Drizzle. */
const config: KnipConfig = {
  workspaces: {
    '.': {},
    'apps/server': {
      // pino-pretty подключается логгером по имени строкой (transport target), статически knip его не видит.
      ignoreDependencies: ['pino-pretty'],
    },
    'apps/web': {},
    'packages/shared': {},
  },
};

export default config;
