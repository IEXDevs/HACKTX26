/**
 * Creating helper agents during a run. Two runs can try to create the same
 * helper at the same moment; each run only has its own snapshot of agents.
 * This re-checks the database first and reuses a helper another run just
 * made, and retries with a new slug if two inserts still collide.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents, type AgentRow } from "@/lib/db/schema";
import { newId } from "@/lib/env";

type NewAgent = typeof agents.$inferInsert & { parentAgentId: string };

async function existingHelper(parentAgentId: string, name: string): Promise<AgentRow | undefined> {
  const [row] = await (await getDb())
    .select()
    .from(agents)
    .where(and(eq(agents.parentAgentId, parentAgentId), eq(agents.name, name)))
    .limit(1);
  return row;
}

/** Bring a retired helper back for new work. */
export async function reactivateHelper(row: AgentRow): Promise<AgentRow> {
  if (row.status !== "archived") return row;
  await (await getDb()).update(agents).set({ status: "active", updatedAt: new Date() }).where(eq(agents.id, row.id));
  return { ...row, status: "active" };
}

/**
 * Insert a helper under its parent, or return the one that already exists.
 * `created` is false when another run made it first.
 */
export async function insertHelperAgent(values: NewAgent): Promise<{ row: AgentRow; created: boolean }> {
  const baseSlug = values.slug;
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await existingHelper(values.parentAgentId, values.name);
    if (existing) return { row: await reactivateHelper(existing), created: false };
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${newId("x").slice(2, 8)}`;
    const [row] = await (await getDb()).insert(agents).values({ ...values, slug })
      .onConflictDoNothing({ target: [agents.workspaceId, agents.slug] }).returning();
    if (row) return { row, created: true };
    // Lost a race on the slug: loop to reuse the winner or pick a new slug.
  }
  throw new Error(`Could not create ${values.name}: its name kept colliding with another agent.`);
}
