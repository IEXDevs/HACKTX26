import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/inputs/[id]/route";
import { executeRun } from "./orchestrator";
import { getDb } from "../db/client";
import { inputRequests, runCheckpoints, runs, workspaces } from "../db/schema";

vi.mock("./orchestrator", () => ({ executeRun: vi.fn(async () => undefined) }));
vi.mock("../queries", () => ({ getWorkspaceUser: vi.fn(async () => ({ workspace: { id: "ws_input_api" }, user: { email: "operator@local" } })) }));

async function reply(answer: string, id = "inp_api") {
  return POST(new NextRequest("http://localhost/api/inputs/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) }), { params: Promise.resolve({ id }) });
}

describe("input answer API", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    vi.mocked(executeRun).mockClear();
    const db = getDb();
    await db.insert(workspaces).values({ id: "ws_input_api", slug: "input-api", name: "Input API", createdAt: new Date() });
    await db.insert(runs).values({ id: "run_input_api", workspaceId: "ws_input_api", agentId: "agt_api", goal: "Select the requested course.", status: "awaiting_input", budgetUsd: 1, startedAt: new Date() });
    await db.insert(inputRequests).values({ id: "inp_api", workspaceId: "ws_input_api", runId: "run_input_api", agentId: "agt_api", callId: "call_api", question: "Which course?", reason: "Two courses match.", requestedAt: new Date() });
    await db.insert(runCheckpoints).values({ runId: "run_input_api", state: { frames: [], delegations: [], spawned: [], grunts: [], highRiskGrants: [], connectors: [], budgetWrapUp: [] }, updatedAt: new Date() });
  });

  it("saves an answer and dispatches the same run once", async () => {
    expect((await reply("CS 314")).status).toBe(200);
    expect(executeRun).toHaveBeenCalledExactlyOnceWith("run_input_api");
    expect((await reply("CS 311")).status).toBe(409);
    expect(executeRun).toHaveBeenCalledTimes(1);
  });

  it("rejects blank answers without dispatching work", async () => {
    expect((await reply("  ")).status).toBe(400);
    expect(executeRun).not.toHaveBeenCalled();
  });

  it("keeps workspace access checks on the answer route", async () => {
    await getDb().update(inputRequests).set({ workspaceId: "other_workspace" });
    expect((await reply("CS 314")).status).toBe(404);
    expect(executeRun).not.toHaveBeenCalled();
  });
});
