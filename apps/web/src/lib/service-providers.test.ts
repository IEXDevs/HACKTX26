import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceApiKey } from "./service-keys";
import { requireComposio, listConnectedFromComposio, executeComposioActionRaw } from "./composio";
import { serpSearch } from "./serpapi";

const sdk = vi.hoisted(() => ({ keys: [] as string[], list: vi.fn(), execute: vi.fn() }));
vi.mock("./service-keys", () => ({ serviceApiKey: vi.fn() }));
vi.mock("@composio/core", () => ({ Composio: class {
  connectedAccounts = { list: sdk.list };
  tools = { execute: sdk.execute };
  constructor({ apiKey }: { apiKey: string }) { sdk.keys.push(apiKey); }
} }));
beforeEach(() => {
  sdk.keys = []; sdk.list.mockReset().mockResolvedValue([]); sdk.execute.mockReset().mockResolvedValue({ data: "done" });
  vi.mocked(serviceApiKey).mockReset().mockImplementation(async (purpose, id) => `${purpose}-${id}-private-key`);
});
afterEach(() => vi.unstubAllGlobals());
describe("saved service keys", () => {
  it("creates separate Composio clients for each caller and preserves user filters", async () => {
    await listConnectedFromComposio("a"); await listConnectedFromComposio("b");
    expect(sdk.keys).toEqual(["composio-a-private-key", "composio-b-private-key"]);
    expect(sdk.list).toHaveBeenNthCalledWith(1, { userIds: ["a"] });
    expect(sdk.list).toHaveBeenNthCalledWith(2, { userIds: ["b"] });
    await executeComposioActionRaw({ userId: "b", toolkit: "gmail", action: "send" });
    expect(sdk.execute).toHaveBeenCalledWith("GMAIL_SEND", expect.objectContaining({ userId: "b" }));
  });
  it("reports missing Composio keys without env instructions", async () => {
    vi.mocked(serviceApiKey).mockResolvedValue(null);
    await expect(requireComposio("a")).rejects.toThrow("Saved keys");
  });
  it("uses the caller's SerpAPI key and hides upstream error text", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "serpapi-a-private-key" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(serpSearch({ query: "public query", accountId: "a" })).rejects.toThrow("HTTP 401");
    expect(fetcher.mock.calls[0]![0].searchParams.get("api_key")).toBe("serpapi-a-private-key");
    fetcher.mockResolvedValue(Response.json({ organic_results: [{ title: "Result", link: "https://example.com" }] }));
    expect(await serpSearch({ query: "public query", accountId: "b" })).toEqual([{ title: "Result", url: "https://example.com", snippet: "" }]);
    expect(fetcher.mock.calls[1]![0].searchParams.get("api_key")).toBe("serpapi-b-private-key");
  });
});
