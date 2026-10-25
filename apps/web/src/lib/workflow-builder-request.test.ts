import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/builder/route";
import { askBuilder } from "./runtime/builder";

vi.mock("./runtime/builder", () => ({ askBuilder: vi.fn(async () => ({ reply: "Ready.", draft: null })) }));
vi.mock("./queries", () => ({ requireWorkspace: vi.fn(async () => ({ id: "ws_test" })) }));

async function request(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/builder", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Fill in the missing instructions." }], ...body }),
  }));
}

describe("building from the visible workflow graph", () => {
  beforeEach(() => { vi.mocked(askBuilder).mockClear(); });

  it("passes a large, incomplete graph to the model for revision", async () => {
    const draft = JSON.stringify({ name: "Lead", instructions: "", summary: "s".repeat(7000) });
    expect((await request({ workflowMode: "automatic", draft })).status).toBe(200);
    expect(askBuilder).toHaveBeenCalledWith(expect.any(Array), { workspaceId: "ws_test", workflowMode: "automatic", draft });
  });

  it("keeps manual building outside the model route", async () => {
    expect((await request({ workflowMode: "manual" })).status).toBe(400);
    expect(askBuilder).not.toHaveBeenCalled();
  });
});
