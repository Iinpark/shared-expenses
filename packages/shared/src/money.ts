import { minorDigits, type CurrencyCode } from './currency.js';

/**
 * Деньги. Сумма — всегда целое число минимальных единиц валюты (копеек, тиынов, центов;
 * у иены — самих иен). Здесь только перевод между числом и текстом, никакой арифметики с дробями.
 */

/** Самая большая сумма одного расхода в минимальных единицах. С запасом меньше Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT = 100_000_000_000; // 1 млрд рублей

const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * «1 000,00» для 100000 копеек, «−33,33» для −3333. Знак плюс — по запросу (для балансов).
 * Разделитель тысяч — неразрывный пробел, чтобы сумма не переносилась.
 */
export function formatAmount(minor: number, currency: CurrencyCode, opts: { sign?: boolean } = {}): string {
  const digits = minorDigits(currency);
  const abs = Math.abs(minor);
  const scale = 10 ** digits;
  const whole = groupThousands(String(Math.floor(abs / scale)));
  const frac = digits ? ',' + String(abs % scale).padStart(digits, '0') : '';
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return sign + whole + frac;
}

/**
 * Разбирает то, что человек ввёл в поле суммы: «1 000,5», «1000.50», «1000».
 * Возвращает минимальные единицы или null, если это не сумма (лишние знаки после запятой тоже null).
 */
export function parseAmount(text: string, currency: CurrencyCode): number | null {
  const clean = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (!clean) return null;
  const digits = minorDigits(currency);
  const re = digits ? new RegExp(`^(\\d+)(?:\\.(\\d{0,${digits}}))?$`) : /^(\d+)$/;
  const m = re.exec(clean);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(digits, '0') || '0');
  const minor = whole * 10 ** digits + frac;
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Сумма для поля ввода: без разделителя тысяч и без лишних нулей («1000», «1000,5»). */
export function amountToInput(minor: number, currency: CurrencyCode): string {
  const digits = minorDigits(currency);
  const scale = 10 ** digits;
  const whole = Math.floor(minor / scale);
  const frac = minor % scale;
  if (!frac) return String(whole);
  return `${whole},${String(frac).padStart(digits, '0').replace(/0+$/, '')}`;
}
