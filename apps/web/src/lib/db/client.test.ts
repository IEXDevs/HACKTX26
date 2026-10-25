import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyPendingMigrations, getDb } from "./client";

function sqliteOf(): Database.Database {
  return (globalThis as unknown as { __agentOsDb: { sqlite: Database.Database } }).__agentOsDb.sqlite;
}

function migrationHash(tag: string): string {
  const file = path.resolve(process.cwd(), "src/lib/db/migrations", `${tag}.sql`);
  return createHash("sha256").update(fs.readFileSync(file, "utf8")).digest("hex");
}

describe("migrations", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __agentOsDb?: unknown }).__agentOsDb;
    getDb();
  });

  it("does not re-run a file whose hash is recorded with an older timestamp", () => {
    const sqlite = sqliteOf();
    const hash = migrationHash("0010_composio_connectors");
    sqlite.prepare("update `__drizzle_migrations` set `created_at` = 1 where `hash` = ?").run(hash);

    expect(() => applyPendingMigrations()).not.toThrow();

    const cols = sqlite.prepare("pragma table_info(agents)").all() as Array<{ name: string }>;
    expect(cols.some((col) => col.name === "allowed_connectors")).toBe(true);
  });
});
