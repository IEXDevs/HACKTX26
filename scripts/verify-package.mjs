import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(workspace, "apps/web/.next/standalone/apps/web");
const migrations = path.join(app, "src/lib/db/pg-migrations");
assert.ok(fs.existsSync(path.join(migrations, "..", "supabase-ca.crt")), "Missing packaged Supabase database CA certificate.");
assert.ok(!fs.existsSync(path.join(app, ".data/agent-os.db")), "A local runtime database was copied into the package.");
assert.ok(!fs.readdirSync(app).some((name) => name.startsWith(".env")), "Local environment files were copied into the package.");
const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta/_journal.json"), "utf8"));
for (const entry of journal.entries) assert.ok(fs.existsSync(path.join(migrations, `${entry.tag}.sql`)), `Missing packaged migration ${entry.tag}`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-package-test-"));
const database = path.join(temporary, "custom-data", "postgres");
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const child = spawn(process.execPath, [path.join(app, "server.js")], {
  cwd: app, windowsHide: true,
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
    DATABASE_URL: `pglite://${database}`, SANDBOX_ROOT: path.join(temporary, "sandboxes"), MODEL_GATEWAY: "scripted",
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", COMPOSIO_API_KEY: "", SERPAPI_API_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
const exited = new Promise((resolve) => child.once("exit", resolve));
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Packaged server exited: ${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok && fs.existsSync(database)) { ready = true; break; }
    } catch { /* The server is still starting. */ }
    await delay(200);
  }
  assert.ok(ready, `Packaged server did not become ready: ${logs}`);
  child.kill();
  await exited;
  const require = createRequire(path.join(workspace, "apps/web/package.json"));
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite(database);
  try {
    const journalRows = await db.query("SELECT count(*)::int AS count FROM astronom.__drizzle_migrations");
    assert.equal(journalRows.rows[0].count, journal.entries.length);
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='astronom' AND table_name='agents'");
    assert.ok(columns.rows.some((column) => column.column_name === "allowed_connectors"));
  } finally { await db.close(); }
  console.log(`Packaged server started and applied all ${journal.entries.length} Postgres migrations at a custom database path.`);
} finally {
  child.kill();
  await exited;
  assert.ok(temporary.startsWith(path.join(os.tmpdir(), "astronom-package-test-")));
  fs.rmSync(temporary, { recursive: true, force: true });
}
