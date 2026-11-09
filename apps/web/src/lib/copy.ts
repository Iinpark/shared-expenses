import copy from '../copy.ru.json';

/** Все тексты интерфейса лежат в copy.ru.json (из handoff дизайна), шуточные — в разделе fun. */
export { copy };

/** Подставляет значения в шаблон: fill('{name} зовёт', { name: 'Аня' }). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
