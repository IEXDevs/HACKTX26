import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

interface DbCache {
  db: AppDatabase;
  sqlite: Database.Database;
}

const globalForDb = globalThis as unknown as { __agentOsDb?: DbCache };

function resolveSqliteFile(url: string): string {
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  if (raw === ":memory:") return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function migrationsFolder(): string {
  // Works both from `next dev` (apps/web cwd) and the compiled server.
  const candidates = [
    path.resolve(process.cwd(), "src/lib/db/migrations"),
    path.resolve(process.cwd(), "apps/web/src/lib/db/migrations"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function isDuplicateColumn(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause)}` : String(error);
  return /duplicate column name/i.test(message);
}

function markNextMigrationApplied(sqlite: Database.Database, folder: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const applied = sqlite.prepare("select hash from `__drizzle_migrations`").all() as Array<{ hash: string }>;
  const known = new Set(applied.map((row) => row.hash));
  const insert = sqlite.prepare(
    "insert into `__drizzle_migrations` (`hash`, `created_at`) values (?, ?)",
  );
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (known.has(hash)) continue;
    insert.run(hash, entry.when);
    break;
  }
}

function create(): DbCache {
  const file = resolveSqliteFile(env.databaseUrl);
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema }) as AppDatabase;

  const folder = migrationsFolder();
  if (fs.existsSync(folder)) {
    for (let attempt = 0; ; attempt++) {
      try {
        migrate(db, { migrationsFolder: folder });
        break;
      } catch (error) {
        // Column already present (db:push or a previous partial migrate) but
        // `__drizzle_migrations` never recorded it. Stamp that file and retry.
        if (!isDuplicateColumn(error) || attempt > 8) throw error;
        markNextMigrationApplied(sqlite, folder);
      }
    }
  } else if (!env.isProduction) {
    // No generated migrations yet (fresh clone before `pnpm db:generate`).
    // Fall back to a schema push at boot so `pnpm dev` never dead-ends.
    // eslint-disable-next-line no-console
    console.warn(
      `[db] no migrations folder at ${folder}; run \`pnpm db:generate\` to create one.`,
    );
  }

  return { db, sqlite };
}

export function getDb(): AppDatabase {
  if (!globalForDb.__agentOsDb) {
    globalForDb.__agentOsDb = create();
  }
  return globalForDb.__agentOsDb.db;
}

export function getSqlite(): Database.Database {
  if (!globalForDb.__agentOsDb) {
    globalForDb.__agentOsDb = create();
  }
  return globalForDb.__agentOsDb.sqlite;
}

/** Test helper: build an isolated in-memory database with the real schema. */
export function createTestDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  const folder = migrationsFolder();
  if (fs.existsSync(folder)) {
    migrate(db, { migrationsFolder: folder });
  }
  return db;
}

export { schema };
