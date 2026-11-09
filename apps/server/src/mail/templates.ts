import { byGender, currencyName, isCurrencyCode, type Gender } from '@se/shared';
import { escapeHtml, renderEmail, renderText } from './layout.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function loginCodeEmail(to: string, code: string): EmailMessage {
  const title = `Код для входа: ${code}`;
  return {
    to,
    subject: title,
    html: renderEmail({
      title,
      paragraphs: ['Введи этот код на странице входа. Он действует 10 минут.'],
      footer: 'Это был не ты? Просто удали письмо: без кода в аккаунт не попасть.',
    }),
    text: renderText({ title, lines: ['Введи этот код на странице входа. Он действует 10 минут.'] }),
  };
}

/** Перечисление по-русски: «Аня», «Аня и Борис», «Аня, Борис и Вика». */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
}

function currencyLabel(code: string) {
  return isCurrencyCode(code) ? (currencyName(code).split(' ').at(-1) ?? code) : code;
}

/** Письмо E01: приглашение в группу. */
export function inviteEmail(p: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  inviterGender: Gender | null;
  groupName: string;
  currency: string;
  memberNames: string[];
  url: string;
}): EmailMessage {
  const subject = `${p.inviterName} зовёт тебя в группу «${p.groupName}»`;
  const about = `В группе записывают, кто за кого платил, и считают, кто кому сколько должен. Уже внутри: ${joinNames(p.memberNames)}. Валюта группы: ${currencyLabel(p.currency)}.`;
  return {
    to: p.to,
    subject,
    html: renderEmail({
      greeting: 'Привет!',
      title: escapeHtml(subject),
      paragraphs: [escapeHtml(about)],
      button: { label: 'Присоединиться', url: p.url },
      notes: ['Пароль не нужен: войдёшь по коду, который придёт на эту почту.'],
      footer: `Письмо пришло, потому что ${escapeHtml(p.inviterName)} (${escapeHtml(p.inviterEmail)}) ${byGender(p.inviterGender, 'указал', 'указала')} твой адрес. Не знаешь, кто это? Просто удали письмо, в группу тебя не добавят.`,
    }),
    text: renderText({ title: subject, lines: [about, '', 'Присоединиться:'], url: p.url }),
  };
}
