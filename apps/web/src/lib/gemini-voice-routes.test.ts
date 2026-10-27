import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as astro } from "@/app/api/gemini/astro/route";
import { POST as call } from "@/app/api/voice/[agentId]/session/route";

const state = vi.hoisted(() => ({ accountId: "account-a", signedIn: true, key: "private-test-gemini-key", mint: vi.fn(), context: vi.fn() }));
vi.mock("./account-assets", () => {
  class AssetError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  return { AssetError, assetFailure: (error: AssetError) => Response.json({ error: error.message }, { status: error.status }), requireAssetAccount: async () => {
    if (!state.signedIn) throw new AssetError("Sign in.", 401);
    return { workspaceId: "ws-test", accountId: state.accountId };
  } };
});
vi.mock("./gemini-account", () => ({ voiceApiKey: vi.fn(async (id: string) => id === state.accountId ? state.key || null : null) }));
vi.mock("./gemini", () => ({ mintLiveToken: state.mint }));
vi.mock("./astro", () => ({ astroSessionConfig: async () => ({ systemInstruction: "Astro", functions: [] }) }));
vi.mock("./audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/app/api/voice/_shared", () => ({ voiceContext: state.context }));
vi.mock("./voice-line", () => ({ DEFAULT_VOICE_TIME_ZONE: "UTC", validTimeZone: () => null, resolveVoiceApps: async () => [], voiceSessionConfig: () => ({ systemInstruction: "Call", functions: [] }), startVoiceCall: async () => "run-test", VOICE_GREETING: "Hello" }));

beforeEach(() => {
  state.accountId = "account-a"; state.signedIn = true; state.key = "private-test-gemini-key";
  state.mint.mockReset().mockResolvedValue({ token: "short-lived-token", model: "test-model", expiresAt: "soon" });
  state.context.mockReset().mockImplementation(async () => state.signedIn
    ? { ok: true, agent: { id: "agent-test", name: "Call agent" }, operatorUserId: state.accountId }
    : { ok: false, response: Response.json({ error: "Sign in." }, { status: 401 }) });
});
const startCall = () => call(new NextRequest("http://localhost/api/voice/agent-test/session", { method: "POST", body: JSON.stringify({ allowBooking: false }) }), { params: Promise.resolve({ agentId: "agent-test" }) });

describe.each([["Astro", astro], ["agent call", startCall]] as const)("%s voice", (_name, start) => {
  it("passes the caller's key to the server SDK and returns only a short-lived token", async () => {
    const response = await start();
    expect(response.status).toBe(200);
    expect(state.mint).toHaveBeenCalledWith(expect.any(Object), { apiKey: state.key });
    expect(await response.text()).not.toContain(state.key);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("requires sign-in before minting tokens", async () => {
    state.signedIn = false;
    expect((await start()).status).toBe(401);
    expect(state.mint).not.toHaveBeenCalled();
  });
  it("asks for a saved key when missing", async () => {
    state.key = "";
    expect((await start()).status).toBe(503);
    expect(state.mint).not.toHaveBeenCalled();
  });
  it("does not expose provider errors that may contain a key", async () => {
    state.mint.mockRejectedValue(new Error(state.key));
    const response = await start();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(state.key);
  });
});
