import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/policy/route";
import { getDb } from "./db/client";
import { auditLog, workspaces } from "./db/schema";

vi.mock("./queries", () => ({ getWorkspaceUser: async () => ({
  workspace: (await getDb().select().from(workspaces).where(eq(workspaces.id, "ws_policy_test")))[0],
  user: { id: "operator", email: "operator@local" },
}) }));

async function patch(body: unknown) {
  return PATCH(new NextRequest("http://localhost/api/policy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("AI permission settings", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    await getDb().insert(workspaces).values([
      { id: "ws_policy_test", slug: "policy-test", name: "Policy test", createdAt: new Date() },
      { id: "ws_other", slug: "other", name: "Other workspace", createdAt: new Date() },
    ]);
  });

  it("defaults to requesting the user's permission", async () => {
    expect(await (await GET()).json()).toMatchObject({ approvalMode: "request" });
  });

  it("saves motivator review for this workspace without changing blocked actions", async () => {
    const response = await patch({ approvalMode: "motivator" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ approvalMode: "motivator", effects: { "cli:prod-deploy": "deny", "shell.exec": "require_approval" } });
    expect((await getDb().select().from(workspaces).where(eq(workspaces.id, "ws_other")))[0]!.approvalMode).toBe("request");
    expect((await getDb().select().from(auditLog))[0]!.detail).toMatchObject({ approvalMode: "motivator", previousApprovalMode: "request" });
    expect((await patch({ approvalMode: "request" })).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({ approvalMode: "request" });
  });

  it("keeps action settings and approval mode independent", async () => {
    await patch({ effects: { "fs.write": "deny" }, approvalMode: "motivator" });
    await patch({ effects: { "http.fetch": "require_approval" } });
    expect(await (await GET()).json()).toMatchObject({ approvalMode: "motivator", effects: { "fs.write": "deny", "http.fetch": "require_approval" } });
    await patch({ approvalMode: "request" });
    expect(await (await GET()).json()).toMatchObject({ effects: { "fs.write": "deny" } });
  });

  it.each([{}, { approvalMode: "automatic" }, { approvalMode: true }, { effects: { "fs.read": "bad" }, approvalMode: "motivator" }])("rejects invalid settings without changing the workspace", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect((await getDb().select().from(workspaces).where(eq(workspaces.id, "ws_policy_test")))[0]!.approvalMode).toBe("request");
  });
});
