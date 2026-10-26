import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { closeDatabase, getDb, type AppDatabase } from "./client";
import * as schema from "./schema";

function orderedTables(): PgTable[] {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
  const result: PgTable[] = [];
  const visited = new Set<PgTable>();
  function visit(table: PgTable) {
    if (visited.has(table)) return;
    visited.add(table);
    for (const key of getTableConfig(table).foreignKeys) visit(key.reference().foreignTable);
    result.push(table);
  }
  tables.forEach(visit);
  return result;
}

/** Read one consistent snapshot. The source is opened read-only and never changed. */
export async function importSqlite(source: string, target?: AppDatabase): Promise<Record<string, number>> {
  const sqlite = new DatabaseSync(path.resolve(source), { readOnly: true });
  const tables = orderedTables();
  try {
    sqlite.exec("BEGIN");
    const present = new Set((sqlite.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>).map((row) => row.name));
    const snapshots = tables.map((table) => {
      const name = getTableName(table);
      const rows = present.has(name) ? sqlite.prepare(`select * from "${name}"`).all() : [];
      const columns = getTableColumns(table);
      const values = rows.map((row) => Object.fromEntries(Object.entries(columns).flatMap(([key, column]) => {
        if (!(column.name in row)) return [];
        const value = row[column.name];
        const converted = value == null ? null
          : column.dataType === "date" ? new Date(Number(value))
          : column.dataType === "boolean" ? Boolean(value)
          : column.dataType === "json" ? JSON.parse(String(value))
          : value;
        return [[key, converted]];
      })));
      return { table, name, values };
    });
    const counts = Object.fromEntries(snapshots.map(({ name, values }) => [name, values.length]));
    if (target) {
      await target.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(746973761347)`);
        for (const table of tables) {
          const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(table);
          if (row!.count > 0) throw new Error(`Target table ${getTableName(table)} is not empty. Import refused.`);
        }
        for (const { table, values } of snapshots) {
          for (let offset = 0; offset < values.length; offset += 250) {
            await tx.insert(table).values(values.slice(offset, offset + 250));
          }
        }
        for (const { table, name, values } of snapshots) {
          const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(table);
          if (row!.count !== values.length) throw new Error(`Row count mismatch for ${name}. Import rolled back.`);
        }
      });
    }
    sqlite.exec("ROLLBACK");
    return counts;
  } finally {
    sqlite.close();
  }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const source = args.find((arg) => !arg.startsWith("--")) ?? ".data/agent-os.db";
  const apply = args.includes("--apply");
  try {
    const counts = await importSqlite(source, apply ? await getDb() : undefined);
    console.log(apply ? "[import] committed and verified:" : "[import] dry run; source is unchanged:", counts);
    if (!apply) console.log("Set DATABASE_URL to the empty Postgres target, then repeat with --apply.");
  } finally {
    await closeDatabase();
  }
}

if (/import-sqlite\.(ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Import failed."); process.exitCode = 1; });
}
