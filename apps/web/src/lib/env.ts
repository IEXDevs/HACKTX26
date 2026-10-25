import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** SQLite URL, e.g. `file:./.data/agent-os.db`. */
  databaseUrl: process.env.DATABASE_URL ?? "file:./.data/agent-os.db",

  /** Root for per-agent sandboxed filesystems. */
  sandboxRoot:
    process.env.SANDBOX_ROOT ?? path.resolve(process.cwd(), "../..", ".runtime", "workspaces"),

  modelGateway: (process.env.MODEL_GATEWAY ?? "scripted") as
    | "scripted"
    | "openai"
    | "anthropic",

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  },

  defaults: {
    runBudgetUsd: num(process.env.RUN_BUDGET_USD, 2.5),
    maxStepsPerAgent: num(process.env.MAX_STEPS_PER_AGENT, 12),
    maxConcurrentSubagents: num(process.env.MAX_CONCURRENT_SUBAGENTS, 4),
    hardStopBudgets: bool(process.env.HARD_STOP_BUDGETS, true),
  },

  isProduction: process.env.NODE_ENV === "production",
} as const;

/* -------------------------------------------------------------------------- */
/* Secret handling                                                            */
/* -------------------------------------------------------------------------- */

const DEV_SECRET_SEED = "agent-os-local-development-only";

/**
 * 32-byte key for AES-256-GCM. A production deployment must supply
 * CREDENTIAL_ENCRYPTION_KEY; locally we derive a deterministic key so the seed
 * script works out of the box, and say so loudly.
 */
export function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (raw && raw.length > 0) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new Error(
        "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64).",
      );
    }
    return decoded;
  }
  if (env.isProduction) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is required in production; refusing to boot with a derived key.",
    );
  }
  return createHash("sha256").update(DEV_SECRET_SEED).digest();
}

/* -------------------------------------------------------------------------- */
/* IDs                                                                        */
/* -------------------------------------------------------------------------- */

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function now(): Date {
  return new Date();
}
