import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountGeminiKey } from "./account-assets";
import { voiceApiKey } from "./gemini-account";

const config = vi.hoisted(() => ({ nodeEnv: "production", gemini: { apiKey: "shared-development-key" } }));
vi.mock("./env", () => ({ env: config }));
vi.mock("./account-assets", () => ({ accountGeminiKey: vi.fn() }));

beforeEach(() => { config.nodeEnv = "production"; vi.mocked(accountGeminiKey).mockReset(); });
describe("account voice keys", () => {
  it("resolves the caller's key for each request", async () => {
    vi.mocked(accountGeminiKey).mockImplementation(async (id) => id === "a" ? "key-a" : "key-b");
    expect(await voiceApiKey("a")).toBe("key-a");
    expect(await voiceApiKey("b")).toBe("key-b");
  });
  it("does not fall back to a shared server key in production", async () => {
    vi.mocked(accountGeminiKey).mockResolvedValue(null);
    expect(await voiceApiKey("missing")).toBeNull();
  });
  it("keeps local env support for development", async () => {
    config.nodeEnv = "development";
    vi.mocked(accountGeminiKey).mockResolvedValue(null);
    expect(await voiceApiKey("local")).toBe(config.gemini.apiKey);
  });
});
