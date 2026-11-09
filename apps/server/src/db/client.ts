import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => undefined });
export const db = drizzle(sql, { schema });

export type Db = typeof db;
/** Транзакция или сама база: сервисы принимают любое из двух. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;
