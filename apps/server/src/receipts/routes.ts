import multipart from '@fastify/multipart';
import { canEditExpense, RECEIPT_MAX_BYTES, type ExpenseDto, type ReceiptType } from '@se/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { requireProfile } from '../auth/session.js';
import { config } from '../config.js';
import { db, type Tx } from '../db/client.js';
import { expenses } from '../db/schema.js';
import { expenseDto, getMemberExpense } from '../expenses/service.js';
import { assertOpen, getMemberGroup } from '../groups/service.js';
import { forbidden, HttpError, notFound, parse } from '../lib/errors.js';

const params = z.object({ id: z.uuid({ message: 'Расход не найден' }) });

/** Тип файла по первым байтам. Расширению и заголовку от браузера не верим. */
function sniff(buf: Buffer): ReceiptType | null {
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const EXT: Record<ReceiptType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

/** Имя для показа: без путей и управляющих символов, не длиннее 120. */
function cleanName(name: string): string {
  let out = '';
  for (const ch of name.replace(/^.*[\\/]/, '')) if (ch.charCodeAt(0) >= 32) out += ch;
  return out.slice(0, 120) || 'чек';
}

/** Расход под блокировкой группы и с проверкой прав, как при правке. */
async function lockForEdit(tx: Tx, expenseId: string, userId: string) {
  const { group } = await getMemberExpense(tx, expenseId, userId);
  const locked = await getMemberGroup(tx, group.id, userId, { lock: true });
  assertOpen(locked);
  const { expense } = await getMemberExpense(tx, expenseId, userId);
  if (!canEditExpense(expense, userId, locked.ownerId)) throw forbidden('Чек может приложить тот, кто платил, кто внёс расход, или создатель группы');
  return expense;
}

const removeFile = (file: string | null) => (file ? rm(join(config.uploadDir, file), { force: true }) : Promise.resolve());

/**
 * Файл чека к расходу: один на расход, новый заменяет старый. Хранится на диске сервера
 * в папке загрузок под случайным именем; отдаётся только участникам группы.
 */
export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 } });
  await mkdir(config.uploadDir, { recursive: true });

  app.put('/api/expenses/:id/receipt', async (req): Promise<ExpenseDto> => {
    const user = requireProfile(req);
    const { id } = parse(params, req.params);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'validation', 'Выбери файл чека');
    const data = await file.toBuffer().catch(() => {
      throw new HttpError(413, 'too_large', 'Файл больше 10 МБ');
    });
    const type = sniff(data);
    if (!type) throw new HttpError(400, 'validation', 'Чек — это фото (JPG, PNG) или PDF');

    // Сначала файл во временное имя, потом запись в базе, и только после коммита — старый файл удаляем.
    const stored = `${randomUUID()}.${EXT[type]}`;
    const tmp = join(config.uploadDir, `${stored}.part`);
    await writeFile(tmp, data);
    try {
      const { dto, old } = await db.transaction(async (tx) => {
        const expense = await lockForEdit(tx, id, user.id);
        const [row] = await tx
          .update(expenses)
          .set({ receiptFile: stored, receiptName: cleanName(file.filename), receiptType: type, receiptSize: data.length })
          .where(eq(expenses.id, id))
          .returning();
        if (!row) throw notFound('Расход не найден');
        return { dto: await expenseDto(tx, row), old: expense.receiptFile };
      });
      await rename(tmp, join(config.uploadDir, stored));
      await removeFile(old);
      return dto;
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  });

  app.delete('/api/expenses/:id/receipt', async (req): Promise<ExpenseDto> => {
    const user = requireProfile(req);
    const { id } = parse(params, req.params);
    const { dto, old } = await db.transaction(async (tx) => {
      const expense = await lockForEdit(tx, id, user.id);
      const [row] = await tx
        .update(expenses)
        .set({ receiptFile: null, receiptName: null, receiptType: null, receiptSize: null })
        .where(eq(expenses.id, id))
        .returning();
      if (!row) throw notFound('Расход не найден');
      return { dto: await expenseDto(tx, row), old: expense.receiptFile };
    });
    await removeFile(old);
    return dto;
  });

  app.get('/api/expenses/:id/receipt', async (req, reply) => {
    const user = requireProfile(req);
    const { id } = parse(params, req.params);
    const { expense } = await getMemberExpense(db, id, user.id);
    if (!expense.receiptFile || !expense.receiptType) throw notFound('К расходу не приложен чек');
    return reply
      .header('content-type', expense.receiptType)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(expense.receiptName ?? 'чек')}`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=3600')
      .send(createReadStream(join(config.uploadDir, expense.receiptFile)));
  });
}
