import { byGender, currencyName, currencySymbol, formatAmount, isCurrencyCode, type CurrencyCode, type Gender, type GroupReportDto } from '@se/shared';
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

/** Письмо E02: напоминание должнику. Имена не склоняем: получатели — строками таблицы «кому — сколько». */
export function reminderEmail(p: {
  to: string;
  name: string;
  groupName: string;
  currency: string;
  days: number;
  debt: number;
  recipients: { name: string; amount: number }[];
  pending: { name: string; amount: number; createdAt: Date }[];
  ownerName: string;
  url: string;
}): EmailMessage {
  const money = (v: number) => `${formatAmount(v, p.currency as CurrencyCode)} ${currencySymbol(p.currency as CurrencyCode)}`;
  const subject = `${p.groupName}: с тебя ${money(p.debt)}`;
  const intro = `${p.name}, пользуясь случаем, напоминаем про расчёт в группе «${p.groupName}». Прошло уже больше ${p.days} ${plural(p.days, 'дня', 'дней', 'дней')}.`;
  const pendingLines = p.pending.map(
    (s) => `Твоё погашение ${money(s.amount)} (получатель: ${s.name}) от ${dayMonth(s.createdAt)} ещё ждёт подтверждения, поэтому пока не учтено.`,
  );
  const how = 'Переведи деньги как удобно и отметь перевод в группе.';
  const footer = `Напоминаем не чаще раза в неделю. Срок задаёт создатель группы (${p.ownerName}). Приложение не переводит деньги и никогда не просит реквизиты.`;
  const table = [{ label: 'С тебя', value: money(p.debt) }, ...p.recipients.map((r) => ({ label: r.name, value: money(r.amount) }))];
  return {
    to: p.to,
    subject,
    html: renderEmail({
      title: escapeHtml(subject),
      paragraphs: [escapeHtml(intro)],
      table,
      afterTable: [...pendingLines, how].map(escapeHtml),
      button: { label: 'Открыть группу', url: p.url },
      footer: escapeHtml(footer),
    }),
    text: renderText({
      title: subject,
      lines: [intro, '', ...table.map((r) => `${r.label}: ${r.value}`), '', ...pendingLines, how, '', 'Открыть группу:'],
      url: p.url,
    }),
  };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const dayMonth = (d: Date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);

/** Письмо E03: группа закрыта, итог. Уходит всем участникам; повторное закрытие после правок — новое письмо. */
export function closedEmail(p: {
  to: string;
  closedByName: string;
  closedByGender: Gender | null;
  report: GroupReportDto;
  url: string;
}): EmailMessage {
  const r = p.report;
  const money = (v: number) => `${formatAmount(v, r.currency as CurrencyCode)} ${currencySymbol(r.currency as CurrencyCode)}`;
  const nameOf = (id: string) => r.members.find((m) => m.userId === id)?.name ?? '';
  const subject = `«${r.name}» закрыта: итог`;
  const intro = `${p.closedByName} ${byGender(p.closedByGender, 'закрыл', 'закрыла')} группу. Новые расходы добавить нельзя, всё записанное остаётся в отчёте.`;
  const settled = r.transfers.length === 0;
  const table = [
    { label: 'Потрачено вместе', value: money(r.totalSpent) },
    { label: 'Итог', value: settled ? 'Все в расчёте' : `Осталось перевести: ${String(r.transfers.length)}` },
  ];
  const sections = [
    {
      title: 'Кто кому сколько перевёл',
      rows: r.settlements.map((s) => ({
        label: `${nameOf(s.fromId)} → ${nameOf(s.toId)}`,
        value: `${money(s.amount)}, ${s.status === 'confirmed' ? 'подтверждено' : 'ждёт подтверждения'}`,
      })),
    },
    { title: 'Осталось перевести', rows: r.transfers.map((t) => ({ label: `${nameOf(t.fromId)} → ${nameOf(t.toId)}`, value: money(t.amount) })) },
    { title: 'Доли участников: заплатил / доля', rows: r.members.map((m) => ({ label: m.name, value: `${money(m.paid)} / ${money(m.share)}` })) },
  ].filter((sec) => sec.rows.length > 0);
  const footer = 'Нашли ошибку? Создатель группы может открыть её снова и поправить расходы. Тогда итог пересчитается и придёт новым письмом.';
  return {
    to: p.to,
    subject,
    html: renderEmail({
      title: escapeHtml(`Группа «${r.name}» закрыта`),
      paragraphs: [escapeHtml(intro)],
      table,
      sections,
      button: { label: 'Открыть отчёт', url: p.url },
      footer: escapeHtml(footer),
    }),
    text: renderText({
      title: subject,
      lines: [
        intro,
        '',
        ...table.map((t) => `${t.label}: ${t.value}`),
        ...sections.flatMap((sec) => ['', `${sec.title}:`, ...sec.rows.map((x) => `${x.label}: ${x.value}`)]),
        '',
        'Открыть отчёт:',
      ],
      url: p.url,
    }),
  };
}
