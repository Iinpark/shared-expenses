/** Проверка файла чека до отправки: те же правила, что на сервере (там тип ещё и по содержимому). Без запросов к API. */
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from '@se/shared';

const EXTENSIONS = /\.(jpe?g|png|pdf)$/i;

/** Что не так с файлом, или null. Браузер иногда не знает тип — тогда смотрим на расширение. */
export function receiptProblem(file: File): string | null {
  const typeOk = file.type ? (RECEIPT_TYPES as readonly string[]).includes(file.type) : EXTENSIONS.test(file.name);
  if (!typeOk) return 'Чек — это фото (JPG, PNG) или PDF';
  if (file.size > RECEIPT_MAX_BYTES) return 'Файл больше 10 МБ';
  return null;
}

/** Что сделать с чеком при сохранении формы: оставить как есть, убрать или загрузить новый файл. */
export type ReceiptChange = 'keep' | 'remove' | File;

export const RECEIPT_ACCEPT = RECEIPT_TYPES.join(',');
