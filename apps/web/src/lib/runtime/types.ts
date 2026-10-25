/**
 * Model gateway ports.
 *
 * The runtime only depends on this interface. `scripted` is the default so the
 * whole pipeline is reproducible without a network or an API key; `openai` and
 * `anthropic` implement the same contract for real inference.
 */

export interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present when role === "tool"; echoes the call this message answers. */
  toolCallId?: string;
  toolName?: string;
  /** Present when role === "assistant" and the turn requested tools. */
  toolCalls?: ModelToolCall[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema object. */
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
}

export type ModelChunk =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      call: { id: string; name: string; args: Record<string, unknown> };
    }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: "end" | "tool_calls" | "length" };

export interface ModelGateway {
  readonly id: string;
  complete(request: ModelRequest): AsyncIterable<ModelChunk>;
}
