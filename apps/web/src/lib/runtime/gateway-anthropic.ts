import type { ModelChunk, ModelGateway, ModelRequest } from "./types";

interface AnthropicBlock {
  type: "text" | "tool_use";
  id?: string;
  name?: string;
  text?: string;
  input?: unknown;
  partialJson?: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages API, streaming.
 *
 * Usage fields arrive split across `message_start` and `message_delta`, so they
 * are accumulated and emitted once at the end.
 */
export class AnthropicGateway implements ModelGateway {
  readonly id = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async *complete(request: ModelRequest): AsyncIterable<ModelChunk> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    // Anthropic wants tool results as `user` turns containing tool_result blocks,
    // and an assistant turn that both talks and calls tools must be one message
    // holding a text block followed by the tool_use blocks. Consecutive tool
    // results are folded into a single user turn.
    const messages: Array<{
      role: "user" | "assistant";
      content: unknown;
    }> = [];

    for (const message of request.messages) {
      if (message.role === "system") continue;

      if (message.role === "tool") {
        const block = {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content || "(no output)",
        };
        const last = messages[messages.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)) {
          (last.content as unknown[]).push(block);
        } else {
          messages.push({ role: "user", content: [block] });
        }
        continue;
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        const blocks: unknown[] = [];
        if (message.content) blocks.push({ type: "text", text: message.content });
        for (const call of message.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.args ?? {},
          });
        }
        messages.push({ role: "assistant", content: blocks });
        continue;
      }

      messages.push({ role: message.role, content: message.content });
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 2_000,
        temperature: request.temperature ?? 0.2,
        system: system || undefined,
        messages,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Anthropic gateway ${response.status}: ${detail.slice(0, 400) || response.statusText}`,
      );
    }

    const blocks = new Map<number, AnthropicBlock>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: "end" | "tool_calls" | "length" = "end";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const dataLine = raw
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (!data) continue;

        let event: {
          type: string;
          index?: number;
          content_block?: AnthropicBlock;
          delta?: {
            type?: string;
            text?: string;
            partial_json?: string;
            stop_reason?: string | null;
          };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        switch (event.type) {
          case "message_start":
            inputTokens += event.message?.usage?.input_tokens ?? 0;
            outputTokens += event.message?.usage?.output_tokens ?? 0;
            break;
          case "content_block_start": {
            const index = event.index ?? 0;
            const block = event.content_block;
            if (block) blocks.set(index, { ...block, partialJson: "" });
            break;
          }
          case "content_block_delta": {
            const index = event.index ?? 0;
            const block = blocks.get(index);
            if (!block) break;
            if (event.delta?.type === "text_delta" && event.delta.text) {
              block.text = (block.text ?? "") + event.delta.text;
              yield { type: "text", text: event.delta.text };
            } else if (
              event.delta?.type === "input_json_delta" &&
              event.delta.partial_json
            ) {
              block.partialJson = (block.partialJson ?? "") + event.delta.partial_json;
            }
            break;
          }
          case "message_delta":
            outputTokens = Math.max(outputTokens, event.usage?.output_tokens ?? 0);
            if (event.delta?.stop_reason === "tool_use") stopReason = "tool_calls";
            if (event.delta?.stop_reason === "max_tokens") stopReason = "length";
            break;
          case "error":
            throw new Error("Anthropic stream reported an error.");
          default:
            break;
        }
      }
    }

    for (const block of blocks.values()) {
      if (block.type !== "tool_use" || !block.name) continue;
      let args: Record<string, unknown> = {};
      if (block.partialJson) {
        try {
          args = JSON.parse(block.partialJson) as Record<string, unknown>;
        } catch {
          args = { _raw: block.partialJson };
        }
      } else if (block.input && typeof block.input === "object") {
        args = block.input as Record<string, unknown>;
      }
      yield {
        type: "tool_call",
        call: {
          id: block.id ?? `toolu_${Date.now()}`,
          name: block.name,
          args,
        },
      };
    }

    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done", stopReason };
  }
}
