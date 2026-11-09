/**
 * Вёрстка писем по макетам E01–E03: одна колонка 560 px, системные шрифты, табличная вёрстка,
 * кнопка-ссылка с фоном, без картинок.
 */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface EmailParts {
  title: string;
  greeting?: string;
  /** Абзацы уже экранированы или собраны из escapeHtml. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Мелкие абзацы под кнопкой. */
  notes?: string[];
  footer?: string;
}

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderEmail(p: EmailParts): string {
  const rows: string[] = [];
  rows.push(`<tr><td style="padding:28px 36px 0;font-size:14px;font-weight:bold;color:#3A3F49">Совместные расходы</td></tr>`);
  if (p.greeting) rows.push(`<tr><td style="padding:28px 36px 0;font-size:16px;line-height:24px;color:#3A3F49">${p.greeting}</td></tr>`);
  rows.push(
    `<tr><td style="padding:${p.greeting ? 8 : 28}px 36px 0;font-size:24px;line-height:32px;font-weight:bold;color:#1B1D22">${p.title}</td></tr>`,
  );
  for (const para of p.paragraphs) {
    rows.push(`<tr><td style="padding:14px 36px 0;font-size:16px;line-height:24px;color:#3A3F49">${para}</td></tr>`);
  }
  if (p.button) {
    const url = escapeHtml(p.button.url);
    rows.push(`<tr><td style="padding:28px 36px 0">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tbody><tr><td style="background:#1B1D22;border-radius:8px">
<a href="${url}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none">${escapeHtml(p.button.label)}</a>
</td></tr></tbody></table>
</td></tr>`);
    rows.push(
      `<tr><td style="padding:20px 36px 0;font-size:14px;line-height:21px;color:#4F5562">Кнопка не работает? Скопируй ссылку в браузер:<br><a href="${url}" style="color:#1B1D22">${url}</a></td></tr>`,
    );
  }
  for (const note of p.notes ?? []) {
    rows.push(`<tr><td style="padding:14px 36px 0;font-size:14px;line-height:21px;color:#4F5562">${note}</td></tr>`);
  }
  rows.push(
    p.footer
      ? `<tr><td style="padding:28px 36px 28px"><div style="border-top:1px solid #DEE1E6;padding-top:16px;font-size:13px;line-height:20px;color:#5F6572">${p.footer}</div></td></tr>`
      : `<tr><td style="padding:28px 36px 0"></td></tr>`,
  );

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 0;background:#ECEEF1;font-family:${FONT};color:#1B1D22">
<table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid #DEE1E6">
<tbody>${rows.join('\n')}</tbody></table></body></html>`;
}

/** Текстовая версия письма для клиентов без HTML. */
export function renderText(p: { title: string; lines: string[]; url?: string }): string {
  return [p.title, '', ...p.lines, ...(p.url ? ['', p.url] : [])].join('\n');
}
