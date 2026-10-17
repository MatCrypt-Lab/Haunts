import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl, config.databaseSsl);
if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
const app = await buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
