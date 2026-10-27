import { and, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { credentials } from "./db/schema";
import { env } from "./env";
import { openSecret } from "./secrets";

/** Account overrides are never cached or reused for another operator. */
export async function serviceApiKey(purpose: "composio" | "serpapi", accountId?: string | null): Promise<string | null> {
  if (accountId) {
    const [row] = await (await getDb()).select().from(credentials)
      .where(and(eq(credentials.createdBy, accountId), eq(credentials.connectorId, purpose))).limit(1);
    if (row) return openSecret(row);
  }
  // Preserve the existing platform service for accounts without an override.
  return env[purpose].apiKey || null;
}
