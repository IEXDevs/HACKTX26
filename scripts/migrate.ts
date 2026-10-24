import { readFile } from 'node:fs/promises';
import { pool, tx } from '../lib/db';
export async function migrate() {
  await tx(async (db) => {
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
    );
    for (const name of [
      '001_core.sql',
      ...(process.env.TIMESCALE_ENABLED === 'true' ? ['002_timescale.sql'] : []),
      '003_api_requests.sql',
    ]) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      await db.query(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (process.argv[1]?.endsWith('migrate.ts')) {
  await migrate();
  console.log('Migrations applied');
  await pool.end();
}
