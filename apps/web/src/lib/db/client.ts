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
  ensured?: boolean;
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

interface JournalEntry {
  tag: string;
  when: number;
  hash: string;
}

function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return journal.entries.map((entry) => {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    return { tag: entry.tag, when: entry.when, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

function flattenError(error: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 6; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join("\n");
}

function isAlreadyApplied(error: unknown): boolean {
  return /duplicate column name|already exists/i.test(flattenError(error));
}

function hasMigrationsTable(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("select 1 as ok from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  return Boolean(row);
}

/**
 * Drizzle only compares the latest `__drizzle_migrations.created_at` to each
 * file's journal `when`. If a hash was recorded under an older timestamp
 * (db:push, a renamed file, a partial stamp), it will try to run that SQL
 * again. Bump recorded times to match the journal before migrate runs.
 */
function alignMigrationTimestamps(sqlite: Database.Database, folder: string) {
  if (!hasMigrationsTable(sqlite)) return;
  const update = sqlite.prepare(
    "update `__drizzle_migrations` set `created_at` = ? where `hash` = ? and `created_at` < ?",
  );
  sqlite.transaction(() => {
    for (const entry of readJournal(folder)) {
      update.run(entry.when, entry.hash, entry.when);
    }
  })();
}

function stampNextPending(sqlite: Database.Database, folder: string) {
  const last = sqlite.prepare("select max(`created_at`) as t from `__drizzle_migrations`").get() as {
    t: number | null;
  };
  const lastAt = Number(last?.t ?? 0);
  const pending = readJournal(folder).find((entry) => entry.when > lastAt);
  if (!pending) return;
  sqlite
    .prepare("insert into `__drizzle_migrations` (`hash`, `created_at`) values (?, ?)")
    .run(pending.hash, pending.when);
}

/** Tables a partial migrate can skip when it stamps a file without running it. */
function ensureCoreTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kb_documents (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      title text NOT NULL,
      data_class text DEFAULT 'internal' NOT NULL,
      body text NOT NULL,
      added_by text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS kb_documents_workspace_idx ON kb_documents (workspace_id);
    CREATE TABLE IF NOT EXISTS connected_accounts (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      user_id text NOT NULL,
      toolkit text NOT NULL,
      toolkit_name text NOT NULL,
      composio_account_id text,
      auth_config_id text,
      status text DEFAULT 'disconnected' NOT NULL,
      scopes text DEFAULT '[]' NOT NULL,
      metadata text DEFAULT '{}' NOT NULL,
      last_sync_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_user_toolkit_idx
      ON connected_accounts (workspace_id, user_id, toolkit);
    CREATE TABLE IF NOT EXISTS connector_grants (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      toolkit text NOT NULL,
      granted_by text,
      created_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connector_grants_agent_toolkit_idx
      ON connector_grants (agent_id, toolkit);
    CREATE TABLE IF NOT EXISTS connector_catalog (
      toolkit text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text DEFAULT '' NOT NULL,
      logo_url text,
      category text,
      auth_schemes text DEFAULT '[]' NOT NULL,
      popular integer DEFAULT false NOT NULL,
      metadata text DEFAULT '{}' NOT NULL,
      updated_at integer NOT NULL
    );
  `);
}

function applyMigrations(db: AppDatabase, sqlite: Database.Database) {
  const folder = migrationsFolder();
  if (!fs.existsSync(folder)) {
    if (!env.isProduction) {
      // eslint-disable-next-line no-console
      console.warn(
        `[db] no migrations folder at ${folder}; run \`pnpm db:generate\` to create one.`,
      );
    }
    ensureCoreTables(sqlite);
    return;
  }
  alignMigrationTimestamps(sqlite, folder);
  for (let attempt = 0; ; attempt++) {
    try {
      migrate(db, { migrationsFolder: folder });
      ensureCoreTables(sqlite);
      return;
    } catch (error) {
      // Schema already matches (db:push or a previous partial migrate) but
      // `__drizzle_migrations` never recorded this file. Stamp it and retry.
      if (!isAlreadyApplied(error) || attempt > 8) {
        ensureCoreTables(sqlite);
        throw error;
      }
      stampNextPending(sqlite, folder);
    }
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
  applyMigrations(db, sqlite);
  return { db, sqlite };
}

/** Journal mtime the open connection was last migrated against. */
let migratedJournalMtime = -1;

function journalMtime(): number {
  try {
    return fs.statSync(path.join(migrationsFolder(), "meta/_journal.json")).mtimeMs;
  } catch {
    return -1;
  }
}

function cached(): DbCache {
  if (!globalForDb.__agentOsDb) {
    globalForDb.__agentOsDb = create();
    migratedJournalMtime = journalMtime();
  } else if (!env.isProduction) {
    // `next dev` keeps this connection across HMR. Re-run pending files when the
    // journal changes, so a pull that adds a migration (e.g. agents.team) does
    // not 500 until restart, without re-reading every migration on each query.
    const mtime = journalMtime();
    if (mtime !== migratedJournalMtime) {
      applyMigrations(globalForDb.__agentOsDb.db, globalForDb.__agentOsDb.sqlite);
      migratedJournalMtime = mtime;
    }
  }
  return globalForDb.__agentOsDb;
}

export function getDb(): AppDatabase {
  const cache = cached();
  if (!cache.ensured) {
    ensureCoreTables(cache.sqlite);
    cache.ensured = true;
  }
  return cache.db;
}

/** Re-apply pending files on the open connection. Used by tests. */
export function applyPendingMigrations(): void {
  const cache = cached();
  applyMigrations(cache.db, cache.sqlite);
}

export { schema };
