import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/agents/[id]/route";
import { getDb } from "./db/client";
import { seedPlatform } from "./db/seed";
import { agents, auditLog } from "./db/schema";
import { requireWorkspace } from "./queries";
import { canArchiveAgent } from "./required-agents";

vi.mock("./queries", () => ({
  requireWorkspace: vi.fn(async () => ({ id: "ws_astronom" })),
  getWorkspaceUser: vi.fn(async () => ({ user: { email: "operator@local" } })),
}));

async function archive(id: string) {
  return PATCH(new NextRequest(`http://localhost/api/agents/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }),
  }), { params: Promise.resolve({ id }) });
}

describe("required platform agents", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    vi.mocked(requireWorkspace).mockResolvedValue({ id: "ws_astronom" } as Awaited<ReturnType<typeof requireWorkspace>>);
    await seedPlatform();
  });

  it.each(["agt_red_team", "agt_blue_team"])("rejects direct archive requests for %s without changing data", async (id) => {
    await getDb().update(agents).set({ name: "Renamed platform lead" }).where(eq(agents.id, id));
    const response = await archive(id);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("cannot be archived");
    expect((await getDb().select().from(agents).where(eq(agents.id, id)))[0]!.status).toBe("active");
    expect((await getDb().select().from(auditLog)).some((entry) => entry.action === "agent.archived")).toBe(false);
  });

  it("protects built-in and runtime motivators and permits normal agents with a matching display name", async () => {
    expect(canArchiveAgent("builtin-motivator")).toBe(false);
    expect(canArchiveAgent("mot_run_example")).toBe(false);
    const [lead] = await getDb().select().from(agents).where(eq(agents.id, "agt_blue_team"));
    await getDb().insert(agents).values({ ...lead!, id: "mot_run_example", slug: "motivator-test" });
    expect((await archive("mot_run_example")).status).toBe(409);
    await getDb().insert(agents).values({ ...lead!, id: "agt_custom", slug: "custom", name: "Red Team" });
    expect(canArchiveAgent("agt_custom")).toBe(true);
    expect((await archive("agt_custom")).status).toBe(200);
    expect((await getDb().select().from(agents).where(eq(agents.id, "agt_custom")))[0]!.status).toBe("archived");
  });

  it("retains workspace access checks", async () => {
    vi.mocked(requireWorkspace).mockResolvedValue({ id: "other_workspace" } as Awaited<ReturnType<typeof requireWorkspace>>);
    expect((await archive("agt_red_team")).status).toBe(404);
  });

  it("restores previously archived required leads without restoring other agents or paused leads", async () => {
    const db = getDb();
    const [lead] = await db.select().from(agents).where(eq(agents.id, "agt_blue_team"));
    await db.insert(agents).values({ ...lead!, id: "agt_custom", slug: "custom", status: "archived" });
    await db.update(agents).set({ status: "archived" }).where(eq(agents.id, "agt_red_team"));
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, "agt_blue_team"));
    db.$client.exec(fs.readFileSync(path.resolve("src/lib/db/migrations/0013_restore_required_agents.sql"), "utf8"));
    const rows = await db.select().from(agents);
    expect(rows.find((row) => row.id === "agt_red_team")!.status).toBe("active");
    expect(rows.find((row) => row.id === "agt_blue_team")!.status).toBe("paused");
    expect(rows.find((row) => row.id === "agt_custom")!.status).toBe("archived");
  });
});
