import { getDb } from "./db/client";
import { workspaces } from "./db/schema";
import { seedDatabase } from "./db/seed";

let bootstrapPromise: Promise<void> | null = null;

/**
 * First-request bootstrap: migrate (handled by getDb) and seed once.
 *
 * Deliberately not a build step — a reviewer should be able to `pnpm dev` on a
 * clean clone and land in a populated workspace.
 */
export function ensureBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const db = getDb();
      const existing = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
      if (existing.length === 0) {
        await seedDatabase();
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
