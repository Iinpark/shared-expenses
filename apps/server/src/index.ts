import { buildApp } from './app.js';
import { config } from './config.js';
import { sql } from './db/client.js';

const app = await buildApp({ logger: true });

const shutdown = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
