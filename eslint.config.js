// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Самые строгие наборы typescript-eslint (strictTypeChecked + stylisticTypeChecked) с проверкой типов,
 * правила хуков React и ограничение цикломатической сложности. Почему именно так — DECISIONS, раздел 14.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', 'apps/server/drizzle/**', 'eslint.config.js', 'knip.config.ts'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Цикломатическая сложность: число путей через функцию. 10 — классический порог Маккейба.
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Числа в шаблонных строках — обычное дело (суммы, счётчики), остальное по-прежнему запрещено.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Один слой запросов (apps/web/src/lib/queries): ключи кэша и инвалидация живут только там,
    // иначе инвалидация по событиям из потока промахнётся мимо запроса с самодельным ключом.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useQuery', 'useQueries', 'useSuspenseQuery', 'useInfiniteQuery', 'useMutation', 'useQueryClient'],
              message: 'Запросы и кэш — только через хуки из lib/queries.',
            },
          ],
          patterns: [
            {
              regex: '(^|/)lib/api(\\.[jt]s)?$|^\\.\\.?/api(\\.[jt]s)?$',
              message: 'lib/api — только для lib/queries. ApiError и errorText бери из lib/queries.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/lib/queries/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
