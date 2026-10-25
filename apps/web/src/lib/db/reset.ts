/**
 * `pnpm db:reset` — delete the SQLite file and the sandbox tree, then re-seed.
 * Used in development only; refuses to run against production.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { getDb } from "./client";
import { seedDatabase } from "./seed";

async function main() {
  if (env.isProduction) {
    throw new Error("db:reset is disabled in production.");
  }
  const raw = env.databaseUrl.replace(/^file:/, "");
  const file = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);

  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target);
  }
  if (fs.existsSync(env.sandboxRoot)) {
    fs.rmSync(env.sandboxRoot, { recursive: true, force: true });
  }

  // A fresh client recreates the schema through migrations on first access.
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  getDb();
  await seedDatabase();
  // eslint-disable-next-line no-console
  console.log("[db] reset + reseeded");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
