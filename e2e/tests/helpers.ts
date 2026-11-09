import { expect, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E } from '../env.js';

const sql = postgres(E2E.databaseUrl, { max: 1, onnotice: () => undefined });
export const closeDb = () => sql.end({ timeout: 5 });

/** Код входа из очереди писем (в e2e почта не отправляется, письма лежат в email_outbox). */
async function loginCode(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const rows = await sql<{ subject: string }[]>`select subject from email_outbox where "to" = ${email} order by created_at desc limit 1`;
    const code = /(\d{6})/.exec(rows[0]?.subject ?? '')?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`нет кода для ${email}`);
}

/** Вход по коду через интерфейс: почта → код → имя (при первом входе). */
export async function signIn(page: Page, email: string, name: string, submitLabel = 'Получить код') {
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: submitLabel }).click();
  await page.locator('#code').fill(await loginCode(email));
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Готово' }).click();
}

/** Два участника в разных браузерных контекстах: Аня за компьютером, Борис с телефона. */
export async function twoClients(browser: Browser) {
  const anya = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const boris = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  for (const p of [anya, boris]) {
    p.on('pageerror', (err) => {
      throw err;
    });
  }
  return { anya, boris };
}

export const groupIdFromUrl = (page: Page) => {
  const id = /\/groups\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id, `в адресе нет id группы: ${page.url()}`).toBeTruthy();
  return id ?? '';
};
