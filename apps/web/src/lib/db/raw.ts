import { sql } from "drizzle-orm";
import type { AppDatabase } from "./client";

/** For maintenance SQL only. Values stay bound, including the legacy ? slots. */
export async function queryRows<T>(db: Pick<AppDatabase, "execute">, statement: string, params: readonly unknown[] = []): Promise<T[]> {
  const parts = statement.split("?");
  if (parts.length !== params.length + 1) throw new Error("SQL parameter count mismatch.");
  const fragments = parts.flatMap((part, index) => index < params.length
    ? [sql.raw(part), sql`${params[index]}`]
    : [sql.raw(part)]);
  const result = await db.execute(sql.join(fragments, sql.raw("")));
  // postgres.js returns an array; PGlite returns a result object.
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}
