/**
 * Валюты группы. Суммы везде хранятся целым числом минимальных единиц валюты
 * (копейки, тиыны, центы; у иены это сами иены). Сколько знаков после запятой
 * у валюты, знает Intl (стандарт ISO 4217), своя таблица не нужна.
 */

/** Валюты, которые предлагаются при создании группы. Первые три — быстрый выбор. */
export const CURRENCIES = [
  'KZT', 'RUB', 'USD', 'EUR', 'GBP', 'CNY', 'TRY', 'GEL', 'UZS', 'KGS', 'AMD', 'AED', 'THB', 'JPY', 'KRW',
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export const QUICK_CURRENCIES: CurrencyCode[] = ['KZT', 'RUB', 'USD'];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Число знаков после запятой: 2 для рубля и тенге, 0 для иены и воны. */
export function minorDigits(currency: CurrencyCode): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Символ валюты для подписей: «₽», «₸», «$». */
export function currencySymbol(currency: CurrencyCode): string {
  const part = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

/** Название валюты по-русски: «российский рубль», «казахстанский тенге». */
export function currencyName(currency: CurrencyCode): string {
  return new Intl.DisplayNames(['ru'], { type: 'currency' }).of(currency) ?? currency;
}
