import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

const config = loadConfig();
const db = createPool(config.databaseUrl, config.databaseSsl);
try {
  const applied = await migrate(db, undefined, (m) => console.log(m));
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is up to date.');
} finally {
  await db.end();
}
