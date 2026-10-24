import 'dotenv/config';
import pg, { type PoolClient } from 'pg';
const globalDb = globalThis as unknown as { relayPool?: pg.Pool };
export const pool = (globalDb.relayPool ||= new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://relay:relay@127.0.0.1:5432/relay',
  max: process.env.RELAY_LOCAL_DB === 'false' ? 10 : 1,
  // The development socket serializes connections. Release idle clients promptly
  // so the worker, web server and connectors can share its single backend.
  idleTimeoutMillis: process.env.RELAY_LOCAL_DB === 'false' ? 10000 : 1,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
}));
export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
export type Db = Pick<PoolClient, 'query'>;
