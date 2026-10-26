import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as builderPost } from "@/app/api/builder/route";
import { POST as searchPost } from "@/app/api/builder/search/route";

const state = vi.hoisted(() => ({ apps: [] as string[], serp: true }));

vi.mock("./builder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./builder")>()),
  askBuilder: vi.fn(async () => ({
    reply: "Here it is.",
    draft: { name: "Lead", apps: state.apps },
    searches: [],
    model: "test",
    inputTokens: 0,
    outputTokens: 0,
  })),
  builderSearch: vi.fn(async (query: string) => [{ title: query, url: "https://example.com", snippet: "" }]),
}));
vi.mock("../queries", () => ({
  requireWorkspace: vi.fn(async () => ({ id: "ws_test" })),
  getCurrentUser: vi.fn(async () => ({ id: "user_1" })),
}));
vi.mock("../auth", () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock("../connectors", () => ({
  operatorIdFor: (session: string | null | undefined, local?: string | null) => session ?? `local:${local}`,
  connectedToolkitsFor: vi.fn(async (_workspace: string, operator: string) =>
    operator === "local:user_1" ? ["gmail"] : []),
}));
vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  serpApiEnabled: () => state.serp,
}));

function post(handler: (request: NextRequest) => Promise<Response>, url: string, body: unknown) {
  return handler(new NextRequest(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("POST /api/builder", () => {
  beforeEach(() => { state.apps = []; });
  const messages = [{ role: "user", content: "Sort my mail." }];

  it("returns the draft's apps with link status", async () => {
    state.apps = ["gmail", "googlecalendar"];
    const response = await post(builderPost, "http://localhost/api/builder", { messages });
    expect(response.status).toBe(200);
    expect((await response.json()).apps).toEqual([
      { slug: "gmail", name: "Gmail", linked: true },
      { slug: "googlecalendar", name: "Google Calendar", linked: false },
    ]);
  });

  it("returns no apps without a lookup when the draft names none", async () => {
    const response = await post(builderPost, "http://localhost/api/builder", { messages });
    expect(await response.json()).toMatchObject({ reply: "Here it is.", searches: [], apps: [] });
  });
});

describe("POST /api/builder/search", () => {
  beforeEach(() => { state.serp = true; });

  it("returns hits", async () => {
    const response = await post(searchPost, "http://localhost/api/builder/search", { query: "notion mcp server" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hits: [{ title: "notion mcp server", url: "https://example.com", snippet: "" }] });
  });

  it("rejects a missing query", async () => {
    expect((await post(searchPost, "http://localhost/api/builder/search", { query: " " })).status).toBe(400);
    expect((await post(searchPost, "http://localhost/api/builder/search", {})).status).toBe(400);
  });

  it("says when search is not configured", async () => {
    state.serp = false;
    const response = await post(searchPost, "http://localhost/api/builder/search", { query: "notion" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Web search is not configured." });
  });
});
