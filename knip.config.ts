import type { KnipConfig } from 'knip';

/** Мёртвый код: неиспользуемые файлы, экспорты и зависимости. Точки входа knip находит сам по конфигам Vite/Vitest/Drizzle. */
const config: KnipConfig = {
  workspaces: {
    '.': {},
    'apps/server': {
      // pino-pretty подключается логгером по имени строкой (transport target), а @types/ws нужен
      // только для типов сокета @fastify/websocket — статически knip их не видит.
      ignoreDependencies: ['pino-pretty', '@types/ws'],
    },
    'apps/web': {},
    'packages/shared': {},
  },
};

export default config;
