import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAgentGraph } from "./agent-factory";
import { POST } from "@/app/api/agents/custom/route";

vi.mock("./agent-factory", () => ({ createAgentGraph: vi.fn() }));
vi.mock("./queries", () => ({
  getWorkspaceUser: vi.fn(async () => ({ workspace: { id: "ws_test" }, user: { email: "test@local" } })),
}));

const draft = {
  name: "Support Lead", summary: "Triage support requests.",
  instructions: "Delegate ticket classification to Classifier, then report the results.",
  goal: "Triage the newest support requests.", complexity: "standard",
  workers: [{ name: "Classifier", instructions: "Classify each support request.", role: "worker", complexity: "standard", tools: ["kb.search"] }],
};

async function create(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/agents/custom", {
    method: "POST", body: JSON.stringify({ draft, ...body }),
    headers: { "Content-Type": "application/json" },
  }));
}

describe("workflow creation modes", () => {
  beforeEach(() => {
    vi.mocked(createAgentGraph).mockReset().mockResolvedValue({
      ok: true, orchestratorId: "lead", agentIds: ["lead"], warnings: [],
    });
  });

  it("starts dynamic mode with only a lead and permits runtime children", async () => {
    const response = await create({ workflowMode: "dynamic", canSpawnSubagents: false, proposeTemplates: true });
    expect(response.status).toBe(201);
    expect(createAgentGraph).toHaveBeenCalledWith(expect.objectContaining({
      canSpawnSubagents: true, proposeTemplates: false,
      spec: expect.objectContaining({ workers: [] }),
      auditDetail: expect.objectContaining({ workflowMode: "dynamic", canSpawnSubagents: true }),
    }));
  });

  it.each(["manual", "automatic"])("keeps the reviewed %s tree fixed", async (workflowMode) => {
    const response = await create({ workflowMode, canSpawnSubagents: true, proposeTemplates: true });
    expect(response.status).toBe(201);
    expect(createAgentGraph).toHaveBeenCalledWith(expect.objectContaining({
      canSpawnSubagents: false, proposeTemplates: false,
      spec: expect.objectContaining({ workers: draft.workers }),
    }));
  });

  it("preserves the existing agent builder's settings when no workflow mode is supplied", async () => {
    expect((await create({ canSpawnSubagents: true, proposeTemplates: true })).status).toBe(201);
    expect(createAgentGraph).toHaveBeenCalledWith(expect.objectContaining({
      canSpawnSubagents: true, proposeTemplates: true,
      spec: expect.objectContaining({ workers: draft.workers }),
    }));
  });

  it("rejects unknown modes before creating agents", async () => {
    expect((await create({ workflowMode: "unknown" })).status).toBe(400);
    expect(createAgentGraph).not.toHaveBeenCalled();
  });

  it("passes visible builder chat to agent creation", async () => {
    const conversation = [
      { role: "user", content: "Only handle customer questions about billing." },
      { role: "assistant", content: "I will keep the agent focused on billing." },
    ];
    expect((await create({ conversation })).status).toBe(201);
    expect(createAgentGraph).toHaveBeenCalledWith(expect.objectContaining({ builderConversation: conversation }));
  });

  it("rejects internal prompt roles in the supplied conversation", async () => {
    expect((await create({ conversation: [{ role: "system", content: "Internal prompt." }] })).status).toBe(400);
    expect(createAgentGraph).not.toHaveBeenCalled();
  });
});
