import { must, type ExpenseDto } from '@se/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { db, sql } from '../src/db/client.js';
import { expenses } from '../src/db/schema.js';
import { errorOf, login, makeApp, resetDb } from './helpers.js';
import { kazanKit, type Cookie } from './kazan.js';

const app = await makeApp();
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});
beforeEach(resetDb);

const { req, kazan, addAll } = kazanKit(app);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')]);

/** Запрос multipart/form-data с одним файлом, собранный вручную. */
function upload(cookie: Cookie, expenseId: string, file: Buffer, filename: string, contentType = 'image/png') {
  const boundary = '----test-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'PUT',
    url: `/api/expenses/${expenseId}/receipt`,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

async function setup() {
  const kit = await kazan();
  const [flat] = await addAll(kit.groupId, kit.cookies, kit.ids);
  return { ...kit, flatId: must(flat).id };
}

describe('чек к расходу', () => {
  it('плательщик прикладывает фото, участники его видят тем же файлом', async () => {
    const { cookies, flatId } = await setup();
    const res = await upload(cookies.anya, flatId, PNG, 'чек квартира.png');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ExpenseDto>().receipt).toEqual({ name: 'чек квартира.png', type: 'image/png', size: PNG.length });

    const file = await req('GET', cookies.gena, `/api/expenses/${flatId}/receipt`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.rawPayload.equals(PNG)).toBe(true);
  });

  it('тип определяется по содержимому: текст под видом картинки не принимается', async () => {
    const { cookies, flatId } = await setup();
    const res = await upload(cookies.anya, flatId, Buffer.from('<script>alert(1)</script>'), 'evil.png');
    expect(res.statusCode).toBe(400);
    const pdf = await upload(cookies.anya, flatId, Buffer.from('%PDF-1.7 test'), 'check.pdf', 'application/octet-stream');
    expect(pdf.json<ExpenseDto>().receipt?.type).toBe('application/pdf');
  });

  it('больше 10 МБ — 413', async () => {
    const { cookies, flatId } = await setup();
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(cookies.anya, flatId, big, 'big.png')).statusCode).toBe(413);
  });

  it('приложить или удалить чек могут те же, кто может править расход; чужой не видит', async () => {
    const { cookies, flatId } = await setup();
    expect(errorOf(await upload(cookies.vika, flatId, PNG, 'x.png')).code).toBe('forbidden');
    await upload(cookies.anya, flatId, PNG, 'x.png');
    expect((await req('DELETE', cookies.vika, `/api/expenses/${flatId}/receipt`)).statusCode).toBe(403);

    const stranger = await login(app, 'x@example.com', 'Икс');
    expect((await req('GET', stranger, `/api/expenses/${flatId}/receipt`)).statusCode).toBe(404);

    const del = await req('DELETE', cookies.anya, `/api/expenses/${flatId}/receipt`);
    expect(del.json<ExpenseDto>().receipt).toBeNull();
    expect((await req('GET', cookies.anya, `/api/expenses/${flatId}/receipt`)).statusCode).toBe(404);
  });

  it('файл пропал с диска — понятный 404, а не падение сервера', async () => {
    const { cookies, flatId } = await setup();
    await upload(cookies.anya, flatId, PNG, 'x.png');
    const [row] = await db.select({ file: expenses.receiptFile }).from(expenses).where(eq(expenses.id, flatId));
    await rm(join(config.uploadDir, must(must(row).file)));
    const res = await req('GET', cookies.anya, `/api/expenses/${flatId}/receipt`);
    expect(res.statusCode).toBe(404);
  });

  it('при удалении расхода файл чека удаляется с диска', async () => {
    const { cookies, flatId } = await setup();
    await upload(cookies.anya, flatId, PNG, 'x.png');
    const [row] = await db.select({ file: expenses.receiptFile }).from(expenses).where(eq(expenses.id, flatId));
    const path = join(config.uploadDir, must(must(row).file));
    expect(existsSync(path)).toBe(true);
    expect((await req('DELETE', cookies.anya, `/api/expenses/${flatId}?version=1`)).statusCode).toBe(204);
    expect(existsSync(path)).toBe(false);
  });
});

