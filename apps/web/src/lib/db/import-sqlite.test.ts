import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./client";
import { importSqlite } from "./import-sqlite";
import { templates, users, workspaces } from "./schema";

describe("SQLite data import", () => {
  let directory: string;
  let source: string;
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-sqlite-import-"));
    source = path.join(directory, "source.db");
    const sqlite = new DatabaseSync(source);
    sqlite.exec(`
      create table workspaces (id text, name text, slug text, created_at integer);
      insert into workspaces values ('ws_import', 'Imported', 'imported', 1700000000123);
      create table users (id text, workspace_id text, name text, email text, role text, created_at integer);
      insert into users values ('usr_import', 'ws_import', 'Operator', 'operator@example.test', 'engineer', 1700000000123);
      create table templates (id text, key text, name text, category text, description text, outcome text, graph text, builtin integer, created_at integer);
      insert into templates values ('tpl_import', 'imported', 'Imported', 'test', 'Description', 'Outcome', '{"workers":[]}', 0, 1700000000123);
    `);
    sqlite.close();
  });
  afterEach(() => {
    if (!directory.startsWith(path.join(os.tmpdir(), "astronom-sqlite-import-"))) throw new Error("Unexpected test directory.");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("converts timestamps, JSON, and booleans without changing the source", async () => {
    const before = fs.readFileSync(source);
    expect(await importSqlite(source)).toMatchObject({ workspaces: 1, users: 1, templates: 1 });
    const db = await getDb();
    await importSqlite(source, db);
    const [workspace] = await db.select().from(workspaces);
    const [template] = await db.select().from(templates);
    expect(workspace!.createdAt.getTime()).toBe(1700000000123);
    expect(template).toMatchObject({ builtin: false, graph: { workers: [] } });
    expect(await db.select().from(users)).toHaveLength(1);
    expect(fs.readFileSync(source)).toEqual(before);
    await expect(importSqlite(source, db)).rejects.toThrow("not empty");
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("rolls back all imported tables when a row is invalid", async () => {
    const sqlite = new DatabaseSync(source);
    sqlite.exec("update users set workspace_id='missing'");
    sqlite.close();
    const db = await getDb();
    await expect(importSqlite(source, db)).rejects.toThrow();
    expect(await db.select().from(workspaces)).toEqual([]);
    expect(await db.select().from(users)).toEqual([]);
  });
});
