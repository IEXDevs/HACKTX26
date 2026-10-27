import { beforeEach, describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { applyPendingMigrations, getDb, migrationsFolder } from "./client";
import { queryRows } from "./raw";
import { workspaces } from "./schema";

describe("Postgres migrations", () => {
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
  });

  it("applies once and preserves data on repeated migration checks", async () => {
    const db = await getDb();
    await db.insert(workspaces).values({ id: "ws_migrate", name: "Migration", slug: "migration", createdAt: new Date() });
    await applyPendingMigrations();
    expect(await db.select().from(workspaces)).toHaveLength(1);
    const journal = await queryRows<{ count: number }>(db, "select count(*)::int count from astronom.__drizzle_migrations");
    expect(journal[0]!.count).toBe(readMigrationFiles({ migrationsFolder: migrationsFolder() }).length);
  });

  it("keeps all app tables in the private schema with RLS enabled", async () => {
    const tables = await queryRows<{ relname: string; relrowsecurity: boolean }>(await getDb(),
      "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='astronom' and c.relkind='r' and c.relname <> '__drizzle_migrations'");
    expect(tables).toHaveLength(28);
    expect(tables.every((table) => table.relrowsecurity)).toBe(true);
  });
});
