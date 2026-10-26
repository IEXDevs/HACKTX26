/** Reset only the explicit local Postgres database. Remote resets are refused. */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { applyPendingMigrations, closeDatabase, getDb } from "./client";
import { seedPlatform } from "./seed";

async function main() {
  if (env.isProduction || !env.databaseUrl.startsWith("pglite://")) {
    throw new Error("db:reset is allowed only for a local PGlite database in development.");
  }
  const sandbox = path.resolve(env.sandboxRoot);
  if (sandbox === path.parse(sandbox).root) throw new Error("Refusing to reset a filesystem root.");
  const db = await getDb();
  await db.execute(sql`drop schema astronom cascade`);
  await applyPendingMigrations();
  if (fs.existsSync(sandbox)) fs.rmSync(sandbox, { recursive: true, force: true });
  await seedPlatform();
  console.log("[db] reset + platform config seeded");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Reset failed.");
  process.exitCode = 1;
}).finally(closeDatabase);
