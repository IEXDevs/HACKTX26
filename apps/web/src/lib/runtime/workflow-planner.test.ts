import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRow } from "../db/schema";
import { planLibraryWorkflow } from "./workflow-planner";

const state = vi.hoisted(() => ({ completion: "" }));
vi.mock("./builder", () => ({ BUILDER_MODEL: "muse-spark-1.3" }));
vi.mock("../observability", () => ({ recordModelTurn: vi.fn(async () => undefined) }));
vi.mock("./gateway", () => ({
  liveGatewayAvailable: () => true,
  createLiveGateway: () => ({ async *complete() { yield { type: "text", text: state.completion }; } }),
}));

const library = [{ id: "library-agent", name: "Reader", summary: "Reads documents.", allowedTools: ["fs.read"], status: "active", sourceAgentId: null }] as AgentRow[];
const root = { id: "lead", parentId: null, agentId: "library-agent" };
const options = { workspaceId: "ws_test", prompt: "Read the project documents.", library };

describe("arranging existing library agents", () => {
  beforeEach(() => { state.completion = JSON.stringify({ name: "Docs", nodes: [root] }); });

  it("returns an existing-agent selection instead of authoring a new agent", async () => {
    expect(await planLibraryWorkflow({ ...options, mode: "automatic" })).toEqual({ name: "Docs", mode: "automatic", nodes: [root] });
  });

  it("rejects an invented or unavailable agent id", async () => {
    state.completion = JSON.stringify({ name: "Docs", nodes: [{ ...root, agentId: "invented-agent" }] });
    await expect(planLibraryWorkflow({ ...options, mode: "automatic" })).rejects.toThrow("unavailable agent");
  });

  it("keeps only the selected lead in dynamic mode", async () => {
    state.completion = JSON.stringify({ name: "Docs", nodes: [root, { id: "child", parentId: "lead", agentId: "library-agent" }] });
    expect((await planLibraryWorkflow({ ...options, mode: "dynamic" })).nodes).toEqual([root]);
  });
});
