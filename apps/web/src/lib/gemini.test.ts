import {
  Behavior,
  FileState,
  Modality,
  Type,
  type AuthToken,
  type CreateAuthTokenParameters,
  type File as GeminiFile,
} from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  describeWorkflowVideo,
  GEMINI_LIVE_MODEL,
  GEMINI_VIDEO_MODEL,
  mintLiveToken,
  toGeminiSchema,
  type GeminiClient,
} from "./gemini";

type FileCall = (params: { name?: string }) => Promise<GeminiFile>;

function fakeClient(overrides: { upload?: FileCall; get?: FileCall; text?: string } = {}) {
  return {
    authTokens: { create: vi.fn(async (_params: CreateAuthTokenParameters): Promise<AuthToken> => ({ name: "auth_tokens/abc" })) },
    files: {
      upload: vi.fn(
        overrides.upload ?? (async (_params: unknown): Promise<GeminiFile> => ({ name: "files/v1", state: FileState.PROCESSING })),
      ),
      get: vi.fn(
        overrides.get ??
          (async (_params: unknown): Promise<GeminiFile> => ({
            name: "files/v1",
            uri: "https://gemini/files/v1",
            mimeType: "video/mp4",
            state: FileState.ACTIVE,
            videoMetadata: { videoDuration: "42s" },
          })),
      ),
      delete: vi.fn(async (_params: unknown) => ({})),
    },
    models: {
      generateContent: vi.fn(async (_params: unknown) => ({
        text: overrides.text ?? "## Goal\nI copy **new orders** from Gmail into a sheet.",
        usageMetadata: { promptTokenCount: 12_000, candidatesTokenCount: 200, thoughtsTokenCount: 100 },
      })),
    },
  };
}

const video = { data: new Uint8Array([1, 2, 3]).buffer, mimeType: "video/mp4", displayName: "orders.mp4" };
const noSleep = async () => {};

describe("mintLiveToken", () => {
  it("locks the model, instructions, tools, voice, and transcription into a one-use token", async () => {
    const client = fakeClient();
    const now = Date.parse("2026-10-25T12:00:00Z");
    const result = await mintLiveToken(
      {
        systemInstruction: "Be brief.",
        voiceName: "Puck",
        functions: [
          {
            name: "search_web",
            description: "Search.",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
          { name: "build_agent", description: "Build.", parameters: { type: "object", properties: {} } },
        ],
      },
      { client: client as unknown as GeminiClient, now: () => now },
    );

    expect(result).toEqual({ token: "auth_tokens/abc", model: GEMINI_LIVE_MODEL, expiresAt: "2026-10-25T12:30:00.000Z" });
    const params = client.authTokens.create.mock.calls[0]![0] as unknown as { config: Record<string, any> };
    const config = params.config;
    expect(config.uses).toBe(1);
    expect(config.newSessionExpireTime).toBe("2026-10-25T12:02:00.000Z");
    expect(config.lockAdditionalFields).toBeUndefined();
    expect(config.liveConnectConstraints.model).toBe(GEMINI_LIVE_MODEL);
    const live = config.liveConnectConstraints.config;
    expect(live.responseModalities).toEqual([Modality.AUDIO]);
    expect(live.systemInstruction).toBe("Be brief.");
    expect(live.inputAudioTranscription).toEqual({});
    expect(live.outputAudioTranscription).toEqual({});
    expect(live.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
    expect(live.tools[0].functionDeclarations).toEqual([
      {
        name: "search_web",
        description: "Search.",
        behavior: Behavior.BLOCKING,
        parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] },
      },
      { name: "build_agent", description: "Build.", behavior: Behavior.BLOCKING },
    ]);
  });

  it("fails plainly when no token comes back", async () => {
    const client = fakeClient();
    client.authTokens.create.mockResolvedValueOnce({} as never);
    await expect(
      mintLiveToken({ systemInstruction: "x", functions: [] }, { client: client as unknown as GeminiClient }),
    ).rejects.toThrow(/did not return/);
  });
});

describe("toGeminiSchema", () => {
  it("maps JSON schema types and numeric limits", () => {
    expect(
      toGeminiSchema({
        type: "array",
        maxItems: 6,
        items: { type: "string", enum: ["a", "b"] },
        additionalProperties: false,
      }),
    ).toEqual({ type: Type.ARRAY, maxItems: "6", items: { type: Type.STRING, enum: ["a", "b"] } });
  });
});

describe("describeWorkflowVideo", () => {
  it("uploads, waits until active, describes, and deletes the upload", async () => {
    const client = fakeClient();
    const onUsage = vi.fn();
    const text = await describeWorkflowVideo(video, {
      client: client as unknown as GeminiClient,
      sleep: noSleep,
      onUsage,
    });

    expect(text).toBe("Goal\nI copy new orders from Gmail into a sheet.");
    const upload = client.files.upload.mock.calls[0]![0] as unknown as { file: Blob; config: Record<string, string> };
    expect(upload.file).toBeInstanceOf(Blob);
    expect(upload.config).toMatchObject({ mimeType: "video/mp4", displayName: "orders.mp4" });
    expect(client.files.get).toHaveBeenCalledWith({ name: "files/v1" });
    const request = client.models.generateContent.mock.calls[0]![0] as unknown as {
      model: string;
      contents: Array<{ parts: Array<Record<string, any>> }>;
    };
    expect(request.model).toBe(GEMINI_VIDEO_MODEL);
    expect(request.contents[0]!.parts[0]!.fileData).toEqual({ fileUri: "https://gemini/files/v1", mimeType: "video/mp4" });
    expect(request.contents[0]!.parts[1]!.text).toMatch(/first person/);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: GEMINI_VIDEO_MODEL, inputTokens: 12_000, outputTokens: 300 }),
    );
    expect(client.files.delete).toHaveBeenCalledWith({ name: "files/v1" });
  });

  it("rejects videos over five minutes and still deletes the upload", async () => {
    const client = fakeClient({
      upload: async () => ({ name: "files/v2", uri: "u", state: FileState.ACTIVE, videoMetadata: { videoDuration: "900s" } }),
    });
    await expect(
      describeWorkflowVideo(video, { client: client as unknown as GeminiClient, sleep: noSleep }),
    ).rejects.toThrow(/under 5 minutes/);
    expect(client.models.generateContent).not.toHaveBeenCalled();
    expect(client.files.delete).toHaveBeenCalledWith({ name: "files/v2" });
  });

  it("stops when processing fails", async () => {
    const client = fakeClient({ get: async () => ({ name: "files/v1", state: FileState.FAILED }) });
    await expect(
      describeWorkflowVideo(video, { client: client as unknown as GeminiClient, sleep: noSleep }),
    ).rejects.toThrow(/could not read/);
    expect(client.files.delete).toHaveBeenCalled();
  });

  it("gives up after a bounded wait", async () => {
    const client = fakeClient({ get: async () => ({ name: "files/v1", state: FileState.PROCESSING }) });
    await expect(
      describeWorkflowVideo(video, { client: client as unknown as GeminiClient, sleep: noSleep }),
    ).rejects.toThrow(/too long to process/);
    expect(client.files.get.mock.calls.length).toBeLessThanOrEqual(60);
  });

  it("refuses non-video files before uploading", async () => {
    const client = fakeClient();
    await expect(
      describeWorkflowVideo({ ...video, mimeType: "image/png" }, { client: client as unknown as GeminiClient }),
    ).rejects.toThrow(/not a video/);
    expect(client.files.upload).not.toHaveBeenCalled();
  });
});

vi.mock("./queries", () => ({ requireWorkspace: vi.fn(async () => ({ id: "ws_test" })) }));
vi.mock("./account-assets", () => ({ requireAssetAccount: vi.fn(async () => ({ workspaceId: "ws_test", accountId: "test-account" })), AssetError: class extends Error {}, assetFailure: vi.fn() }));
vi.mock("./gemini-account", () => ({ voiceApiKey: vi.fn(async () => null) }));
// Never reach the real API from tests, even when a key is set locally.
vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), geminiEnabled: () => false }));

describe("routes", () => {
  async function upload(file?: File, headers?: Record<string, string>) {
    const { POST } = await import("@/app/api/builder/video/route");
    const { NextRequest } = await import("next/server");
    const form = new FormData();
    if (file) form.set("video", file);
    return POST(new NextRequest("http://localhost/api/builder/video", { method: "POST", body: form, headers }));
  }

  it("asks for a video when none is attached", async () => {
    expect((await upload()).status).toBe(400);
  });

  it("refuses files that are not videos", async () => {
    const response = await upload(new File(["hi"], "notes.txt", { type: "text/plain" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That file is not a video." });
  });

  it("refuses uploads that declare more than 200 MB", async () => {
    const response = await upload(new File(["x"], "big.mp4", { type: "video/mp4" }), {
      "content-length": String(300 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
  });

  it("reports when Gemini is not set up", async () => {
    const response = await upload(new File(["x"], "clip.mp4", { type: "video/mp4" }));
    expect(response.status).toBe(503);
    const { POST } = await import("@/app/api/gemini/astro/route");
    expect((await POST()).status).toBe(503);
  });
});
