import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
const execute = promisify(execFile);
let checkedAt = 0;
let pending: Promise<boolean> | undefined;

async function check(): Promise<boolean> {
  try {
    await (await getDb()).execute(sql`select 1`);
    if (process.env.K_SERVICE) {
      if (!process.env.DOCKER_HOST || process.env.DOCKER_TLS_VERIFY !== "1") return false;
      await fs.access(env.sandboxRoot, fs.constants.W_OK);
      await execute("docker", ["info", "--format={{.ServerVersion}}"], { timeout: 5000, maxBuffer: 1024, windowsHide: true });
    }
    return true;
  } catch {
    return false;
  }
}

/** Dependency readiness without exposing configuration, errors, or key values. */
export async function GET() {
  if (!pending || Date.now() - checkedAt > 10_000) {
    checkedAt = Date.now();
    pending = check();
  }
  const ok = await pending;
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
