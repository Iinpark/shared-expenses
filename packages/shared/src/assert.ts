/**
 * Значение, которое по логике программы обязано быть. Вместо оператора «!»: если инвариант
 * нарушен, падаем сразу с понятным сообщением, а не получаем undefined где-то дальше.
 */
export function must<T>(value: T | null | undefined, what = 'значение'): T {
  if (value === null || value === undefined) throw new Error(`Ожидали ${what}, а его нет`);
  return value;
}
