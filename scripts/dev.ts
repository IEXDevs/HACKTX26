import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
// One owner process serves the embedded local database to web, worker and connectors.
await mkdir('.data', { recursive: true });
let secrets: Record<string, string>;
try {
  secrets = JSON.parse(await readFile('.data/dev-secrets.json', 'utf8'));
} catch {
  secrets = {
    CONNECTOR_SECRET: randomBytes(32).toString('hex'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
  };
  await writeFile('.data/dev-secrets.json', JSON.stringify(secrets));
}
for (const [k, v] of Object.entries(secrets)) if (!process.env[k]) process.env[k] = v;
process.env.RELAY_MODE ||= 'fixture';
process.env.DATABASE_URL ||= 'postgres://relay:relay@127.0.0.1:5432/relay';
let localDb: PGlite | undefined;
let socket: PGLiteSocketServer | undefined;
if (process.env.RELAY_LOCAL_DB !== 'false') {
  localDb = await PGlite.create('.data/postgres');
  socket = new PGLiteSocketServer({
    db: localDb,
    host: '127.0.0.1',
    port: Number(new URL(process.env.DATABASE_URL).port || 5432),
  });
  await socket.start();
  console.log(
    'Local PostgreSQL-compatible PGlite started. Fixture development only; production uses Tiger Data.',
  );
}
const { migrate } = await import('./migrate');
const { seed } = await import('./seed');
await migrate();
await seed();
const children: ChildProcess[] = [];
function start(args: string[]) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && !closing) {
      console.error('A Relay service exited:', code);
      void close();
    }
  });
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  const { pool } = await import('../lib/db');
  await pool.end();
  await socket?.stop();
  await localDb?.close();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
start(['--import', 'tsx', 'services/connectors.ts']);
start(['--import', 'tsx', 'services/worker.ts']);
start(['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1']);
