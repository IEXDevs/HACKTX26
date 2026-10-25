import { getDb } from "./db/client";
import { workspaces } from "./db/schema";
import { ensurePlatformTemplates, seedPlatform } from "./db/seed";

let bootstrapPromise: Promise<void> | null = null;

/**
 * First-request bootstrap: migrate (handled by getDb) and seed the platform
 * configuration once.
 *
 * Deliberately not a build step — `pnpm dev` on a clean clone lands in a
 * working workspace. It starts empty: no sample people, agents, or runs. Every
 * number in the UI comes from what the workspace actually did.
 */
export function ensureBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const db = getDb();
      const existing = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
      if (existing.length === 0) {
        await seedPlatform();
      } else {
        // Templates are platform config: an older database still gets new ones.
        await ensurePlatformTemplates();
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
