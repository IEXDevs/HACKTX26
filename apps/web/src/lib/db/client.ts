import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { desc, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { bigint, serial, text, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbCache {
  db: AppDatabase;
  ready: Promise<void>;
  close: () => Promise<void>;
}

const globalForDb = globalThis as unknown as {
  __agentOsDb?: DbCache;
  __agentOsTestPg?: PGlite;
};

const journal = schema.appSchema.table("__drizzle_migrations", {
  id: serial("id").primaryKey(),
  hash: text("hash").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export function migrationsFolder(): string {
  const local = path.join(process.cwd(), "src/lib/db/pg-migrations");
  if (fs.existsSync(path.join(local, "meta/_journal.json"))) return local;
  return path.join(process.cwd(), "apps/web/src/lib/db/pg-migrations");
}

/** One transaction and a transaction-scoped lock also work with Supavisor. */
async function migrate(db: AppDatabase): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: migrationsFolder() });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(746973761347)`);
    await tx.execute(sql`create schema if not exists astronom`);
    await tx.execute(sql`create table if not exists astronom.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint not null
    )`);
    await tx.execute(sql`alter table astronom.__drizzle_migrations enable row level security`);
    const [last] = await tx.select().from(journal).orderBy(desc(journal.createdAt)).limit(1);
    for (const migration of migrations) {
      if (last && last.createdAt >= migration.folderMillis) continue;
      for (const statement of migration.sql) await tx.execute(sql.raw(statement));
      await tx.insert(journal).values({ hash: migration.hash, createdAt: migration.folderMillis });
    }
  });
}

function create(): DbCache {
  const url = env.databaseUrl;
  let db: AppDatabase;
  let close: () => Promise<void>;
  let reset = false;

  if (/^postgres(?:ql)?:\/\//.test(url)) {
    const client = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname) ? undefined : { rejectUnauthorized: true },
      onnotice: () => undefined,
    });
    db = drizzle(client, { schema });
    close = () => client.end({ timeout: 5 });
  } else {
    if (process.env.K_SERVICE) {
      throw new Error("Cloud Run requires a Supabase Postgres DATABASE_URL. Local storage is not durable.");
    }
    if (!url.startsWith("pglite://")) {
      throw new Error("DATABASE_URL must use postgres:// or pglite://. Import the existing SQLite file with pnpm db:import-sqlite.");
    }
    const directory = url.slice("pglite://".length);
    const memory = directory === ":memory:";
    if (!memory) fs.mkdirSync(path.resolve(directory), { recursive: true });
    const testing = memory && env.nodeEnv === "test";
    reset = testing && Boolean(globalForDb.__agentOsTestPg);
    const client = testing
      ? (globalForDb.__agentOsTestPg ??= new PGlite())
      : new PGlite(memory ? undefined : path.resolve(directory));
    db = localDrizzle(client, { schema });
    close = () => client.close();
  }

  const ready = (async () => {
    // Tests explicitly discard the cache to request a fresh in-memory database.
    if (reset) await db.execute(sql`drop schema if exists astronom cascade`);
    await migrate(db);
  })();
  return { db, ready, close };
}

/** Every caller waits for the schema before issuing its first query. */
export async function getDb(): Promise<AppDatabase> {
  const cache = (globalForDb.__agentOsDb ??= create());
  try {
    await cache.ready;
  } catch (error) {
    if (globalForDb.__agentOsDb === cache) delete globalForDb.__agentOsDb;
    await cache.close().catch(() => undefined);
    throw error;
  }
  return cache.db;
}

export async function applyPendingMigrations(): Promise<void> {
  await migrate(await getDb());
}

export async function closeDatabase(): Promise<void> {
  const cache = globalForDb.__agentOsDb;
  delete globalForDb.__agentOsDb;
  if (cache) {
    await cache.ready.catch(() => undefined);
    await cache.close();
  }
  delete globalForDb.__agentOsTestPg;
}

export { schema };
