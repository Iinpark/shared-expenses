/** Русские мелочи: склонение по числу, перечисления. */

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const members = (n: number) => `${n} ${plural(n, 'участник', 'участника', 'участников')}`;

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
}

/** «двоих», «троих» для кнопки «Создать и позвать двоих». */
export function peopleCount(n: number): string {
  const words = ['', 'одного', 'двоих', 'троих', 'четверых', 'пятерых', 'шестерых', 'семерых', 'восьмерых', 'девятерых', 'десятерых'];
  return words[n] ?? `${n} ${plural(n, 'человека', 'человек', 'человек')}`;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
export const dayMonth = (iso: string) => dateFmt.format(new Date(iso));
