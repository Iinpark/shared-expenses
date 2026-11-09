/** Слой запросов: всё общение с API и кэш TanStack Query. Снаружи lib/api не импортируют (правило в eslint.config.js). */
export { ApiError, errorText } from '../api.js';
export * from './auth.js';
export * from './events.js';
export * from './expenses.js';
export * from './groups.js';
export * from './invites.js';
export * from './realtime.js';
