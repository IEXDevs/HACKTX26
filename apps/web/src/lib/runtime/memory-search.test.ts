import os from "node:os";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { agents, memories, workspaces } from "@/lib/db/schema";
import { seedPlatform } from "@/lib/db/seed";
import { AgentSandbox } from "./sandbox";
import { executeTool, type ToolContext } from "./tools";

describe("memory search", () => {
  it("matches mixed case without exposing another agent or workspace", async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    await seedPlatform();
    const db = await getDb();
    const [agent, other] = await db.select().from(agents);
    expect(agent).toBeDefined();
    expect(other).toBeDefined();
    const now = new Date();
    await db.insert(workspaces).values({ id: "ws_other", name: "Other", slug: "other", createdAt: now });
    await db.insert(memories).values([
      { id: "mem_visible", workspaceId: agent!.workspaceId, scope: "workspace", kind: "fact", content: "RELEASE notes", createdAt: now },
      { id: "mem_agent", workspaceId: agent!.workspaceId, agentId: other!.id, scope: "agent", kind: "fact", content: "RELEASE private agent", createdAt: now },
      { id: "mem_other", workspaceId: "ws_other", scope: "workspace", kind: "fact", content: "RELEASE private workspace", createdAt: now },
    ]);
    const context: ToolContext = {
      workspaceId: agent!.workspaceId,
      runId: "run_memory_search",
      agentId: agent!.id,
      agentName: agent!.name,
      sandbox: new AgentSandbox(os.tmpdir(), agent!.workspaceId, agent!.id),
      dataClass: "internal",
      emit: async () => {},
    };
    const result = await executeTool(context, "memory.search", { query: "release" });
    expect(result.ok).toBe(true);
    expect(result.preview).toContain("RELEASE notes");
    expect(result.preview).not.toContain("private");
  });
});
