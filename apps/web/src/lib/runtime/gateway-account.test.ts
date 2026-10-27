import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";

vi.mock("@/lib/account-assets", () => ({
  requireAssetAccount: async () => ({ accountId: "mine", workspaceId: "ws" }),
  accountMuseKey: async (accountId: string) => accountId === "mine" ? "synthetic-private-muse-key" : null,
}));
vi.mock("@/lib/env", () => ({ env: {
  nodeEnv: "production", modelGateway: "openai",
  openai: { apiKey: "global-key-must-not-be-shared", baseUrl: "https://example.invalid" },
  anthropic: { apiKey: "", baseUrl: "https://example.invalid" },
} }));
afterEach(() => vi.unstubAllGlobals());

describe("account model gateway", () => {
  it("uses the signed-in account's Muse key only for the provider request", async () => {
    const send = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", send);
    const gateway = await createLiveGateway();
    const output = [];
    for await (const chunk of gateway.complete({ model: "meta/muse-spark-1.3", messages: [{ role: "user", content: "Hello" }], tools: [] })) output.push(chunk);
    expect(send.mock.calls[0]![0]).toBe("https://api.meta.ai/v1/chat/completions");
    expect(send.mock.calls[0]![1].headers.authorization).toBe("Bearer synthetic-private-muse-key");
    expect(JSON.stringify(output)).not.toContain("synthetic-private-muse-key");
  });

  it("never falls back to a shared environment key in production", async () => {
    expect(await liveGatewayAvailable("other-account")).toBe(false);
    expect(await liveGatewayAvailable(null)).toBe(false);
    await expect(createLiveGateway("other-account")).rejects.toThrow("Add your Muse key");
  });

  it("does not relay a provider error body that could contain a key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad token synthetic-private-muse-key", { status: 401 })));
    const gateway = await createLiveGateway("mine");
    const collect = async () => { for await (const _chunk of gateway.complete({ model: "meta/muse-spark-1.3", messages: [], tools: [] })) { /* Drain. */ } };
    await expect(collect()).rejects.toThrow("HTTP 401");
    await expect(collect()).rejects.not.toThrow("synthetic-private-muse-key");
  });
});
