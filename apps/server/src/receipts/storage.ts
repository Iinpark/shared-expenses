import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';

/** Путь к файлу чека в папке загрузок. Имя файла всегда серверное (uuid.ext), поэтому выйти из папки нельзя. */
export const receiptPath = (file: string) => join(config.uploadDir, file);

/** Удаляет файл чека с диска (после удаления расхода или замены чека). */
export const removeFile = (file: string | null) => (file ? rm(receiptPath(file), { force: true }) : Promise.resolve());
