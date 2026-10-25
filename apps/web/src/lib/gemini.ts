/**
 * Gemini, server side only. Two jobs:
 *
 * - Mint one-use Live API tokens. The browser talks to Gemini Live directly
 *   with the token; the model, instructions, tools, and voice are locked into
 *   it, so the browser cannot change them. The API key never leaves here.
 * - Turn a screen recording into a plain description of the job it shows.
 *
 * The SDK client is injectable so tests never touch the network.
 */
import {
  Behavior,
  FileState,
  GoogleGenAI,
  Modality,
  Type,
  type AuthToken,
  type CreateAuthTokenParameters,
  type DeleteFileParameters,
  type File as GeminiFile,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GetFileParameters,
  type LiveConnectConfig,
  type Schema,
  type UploadFileParameters,
} from "@google/genai";
import { env, geminiEnabled } from "./env";

/** Live API model for spoken sessions. https://ai.google.dev/gemini-api/docs/models */
export const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
/** Fast multimodal model for workflow videos. https://ai.google.dev/gemini-api/docs/video-understanding */
export const GEMINI_VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL ?? "gemini-3.8-flash";

/** Live token lifetime: messages stop after this. */
const TOKEN_TTL_MS = 30 * 60_000;
/** The browser must open its session within this window. */
const NEW_SESSION_TTL_MS = 2 * 60_000;

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 5 * 60;
/** File processing poll: every 2 s for up to 2 min. */
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 60;

/** USD per 1M tokens for GEMINI_VIDEO_MODEL (paid tier, through 2026). */
const VIDEO_PRICE = { input: 0.75, output: 3.75 };

export interface LiveFunction {
  name: string;
  description: string;
  /** JSON schema object for the arguments. */
  parameters: Record<string, unknown>;
}

export interface LiveSessionConfig {
  systemInstruction: string;
  functions: LiveFunction[];
  voiceName?: string;
}

/** The parts of the SDK client this module uses. A GoogleGenAI instance fits. */
export interface GeminiClient {
  authTokens: { create(params: CreateAuthTokenParameters): Promise<AuthToken> };
  files: {
    upload(params: UploadFileParameters): Promise<GeminiFile>;
    get(params: GetFileParameters): Promise<GeminiFile>;
    delete(params: DeleteFileParameters): Promise<unknown>;
  };
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface GeminiDeps {
  client?: GeminiClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called once a description is generated, for the usage ledger. */
  onUsage?: (usage: GeminiUsage) => void;
}

let cached: GeminiClient | undefined;

function clientFor(deps: GeminiDeps): GeminiClient {
  if (deps.client) return deps.client;
  if (!geminiEnabled()) {
    throw new Error("Voice and video are not set up. Add GEMINI_API_KEY on the server.");
  }
  cached ??= new GoogleGenAI({ apiKey: env.gemini.apiKey });
  return cached;
}

/* -------------------------------------------------------------------------- */
/* Live tokens                                                                */
/* -------------------------------------------------------------------------- */

const TYPES: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/** JSON schema to Gemini's OpenAPI-style Schema, keeping only fields it understands. */
export function toGeminiSchema(json: Record<string, unknown>): Schema {
  const schema: Schema = {};
  if (typeof json.type === "string" && TYPES[json.type]) schema.type = TYPES[json.type];
  if (typeof json.description === "string") schema.description = json.description;
  if (Array.isArray(json.enum)) schema.enum = json.enum.map(String);
  if (Array.isArray(json.required)) schema.required = json.required.map(String);
  if (typeof json.minimum === "number") schema.minimum = json.minimum;
  if (typeof json.maximum === "number") schema.maximum = json.maximum;
  for (const key of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    if (typeof json[key] === "number") schema[key] = String(json[key]);
  }
  if (json.items && typeof json.items === "object") {
    schema.items = toGeminiSchema(json.items as Record<string, unknown>);
  }
  if (json.properties && typeof json.properties === "object") {
    schema.properties = Object.fromEntries(
      Object.entries(json.properties as Record<string, Record<string, unknown>>).map(
        ([name, value]) => [name, toGeminiSchema(value)],
      ),
    );
  }
  return schema;
}

function declaration(fn: LiveFunction): FunctionDeclaration {
  const hasParams = Object.keys((fn.parameters.properties as object | undefined) ?? {}).length > 0;
  return {
    name: fn.name,
    description: fn.description,
    ...(hasParams ? { parameters: toGeminiSchema(fn.parameters) } : {}),
    // The model waits for each result, so the browser only has to answer.
    behavior: Behavior.BLOCKING,
  };
}

/** The session setup locked into a Live token. */
export function liveConnectConfig(config: LiveSessionConfig): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: config.systemInstruction,
    tools: config.functions.length
      ? [{ functionDeclarations: config.functions.map(declaration) }]
      : undefined,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Lets the browser reconnect on the same token when the server rotates the socket.
    sessionResumption: {},
    ...(config.voiceName
      ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } } } }
      : {}),
  };
}

/**
 * A one-use Live API token with the whole session setup locked in. The
 * browser has two minutes to connect; the session ends after thirty.
 */
export async function mintLiveToken(
  config: LiveSessionConfig,
  deps: GeminiDeps = {},
): Promise<{ token: string; model: string; expiresAt: string }> {
  const client = clientFor(deps);
  const now = (deps.now ?? Date.now)();
  const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(now + NEW_SESSION_TTL_MS).toISOString(),
      // No lockAdditionalFields: every field set here is locked.
      liveConnectConstraints: { model: GEMINI_LIVE_MODEL, config: liveConnectConfig(config) },
    },
  });
  if (!token.name) throw new Error("Gemini did not return a voice session. Try again.");
  return { token: token.name, model: GEMINI_LIVE_MODEL, expiresAt };
}

/* -------------------------------------------------------------------------- */
/* Workflow videos                                                            */
/* -------------------------------------------------------------------------- */

export const WORKFLOW_VIDEO_PROMPT = `This is a screen recording of someone doing a job by hand that they want an AI agent to do for them.
Describe the job in the first person, as if they were explaining it to someone who builds agents. Cover:
- the goal of the job,
- the apps, sites, and data they use,
- the steps, in order,
- the decisions and rules they apply along the way,
- what a finished result looks like.
Write plain sentences in one to three short paragraphs, under 250 words. No headings, no markdown, no timestamps.
Describe only what the recording shows. Do not repeat passwords, keys, or other secrets that appear on screen.`;

/** Seconds from a Files API duration such as "93.5s". */
function durationSeconds(file: GeminiFile): number | null {
  const raw = (file.videoMetadata as { videoDuration?: unknown } | undefined)?.videoDuration;
  const match = typeof raw === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(raw) : null;
  return match ? Number(match[1]) : null;
}

function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)} minutes`;
}

/** Strips markdown the model may add despite the prompt. */
function plain(text: string): string {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}

export function videoCostUsd(inputTokens: number, outputTokens: number): number {
  return Number(
    ((inputTokens / 1_000_000) * VIDEO_PRICE.input + (outputTokens / 1_000_000) * VIDEO_PRICE.output).toFixed(6),
  );
}

/**
 * Uploads a screen recording, waits for Gemini to process it, and returns a
 * first-person description of the job it shows. The upload is deleted after.
 */
export async function describeWorkflowVideo(
  input: { data: ArrayBuffer; mimeType: string; displayName: string },
  deps: GeminiDeps = {},
): Promise<string> {
  if (!input.mimeType.startsWith("video/")) throw new Error("That file is not a video.");
  if (input.data.byteLength === 0) throw new Error("That video is empty.");
  if (input.data.byteLength > MAX_VIDEO_BYTES) {
    throw new Error("That video is over 200 MB. Trim it and try again.");
  }
  const client = clientFor(deps);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let file = await client.files.upload({
    file: new Blob([input.data], { type: input.mimeType }),
    config: { mimeType: input.mimeType, displayName: input.displayName.slice(0, 500) || "Workflow video" },
  });
  try {
    for (let poll = 0; file.state !== FileState.ACTIVE; poll++) {
      if (file.state === FileState.FAILED) throw new Error("Gemini could not read that video. Try another file.");
      if (poll >= MAX_POLLS) throw new Error("The video is taking too long to process. Try a shorter one.");
      if (!file.name) throw new Error("Gemini did not accept the upload. Try again.");
      await sleep(POLL_INTERVAL_MS);
      file = await client.files.get({ name: file.name });
    }
    if (!file.uri) throw new Error("Gemini did not accept the upload. Try again.");

    const seconds = durationSeconds(file);
    if (seconds !== null && seconds > MAX_VIDEO_SECONDS + 5) {
      throw new Error(`That video is about ${minutes(seconds)} long. Keep it under 5 minutes.`);
    }

    const response = await client.models.generateContent({
      model: GEMINI_VIDEO_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: { fileUri: file.uri, mimeType: file.mimeType ?? input.mimeType },
              // Caps cost when the length could not be read up front.
              videoMetadata: { endOffset: `${MAX_VIDEO_SECONDS}s` },
            },
            { text: WORKFLOW_VIDEO_PROMPT },
          ],
        },
      ],
    });
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    deps.onUsage?.({
      model: GEMINI_VIDEO_MODEL,
      inputTokens,
      outputTokens,
      costUsd: videoCostUsd(inputTokens, outputTokens),
    });
    const text = plain(response.text ?? "");
    if (!text) throw new Error("Gemini could not describe that video. Try another recording.");
    return text;
  } finally {
    if (file.name) await client.files.delete({ name: file.name }).catch(() => undefined);
  }
}
