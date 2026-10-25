import type { ModelChunk, ModelGateway, ModelRequest } from "./types";

interface OpenAiToolCallFragment {
  index: number;
  id?: string;
  name?: string;
  args: string;
}

/**
 * OpenAI-compatible chat completions, streaming. Works against OpenAI, Azure
 * OpenAI-compatible gateways, vLLM, and anything else that speaks the same SSE
 * shape.
 */
export class OpenAiGateway implements ModelGateway {
  readonly id = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async *complete(request: ModelRequest): AsyncIterable<ModelChunk> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured.");

    const body = {
      // Catalog ids carry a provider prefix (meta/muse-spark-1.3); the API wants the bare name.
      model: request.model.replace(/^[a-z0-9-]+\//, ""),
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.temperature ?? 0.2,
      max_completion_tokens: request.maxOutputTokens ?? 2_000,
      messages: request.messages.map((message) => {
        if (message.role === "tool") {
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            content: message.content,
          };
        }
        if (message.role === "assistant" && message.toolCalls?.length) {
          return {
            role: "assistant",
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args ?? {}),
              },
            })),
          };
        }
        return { role: message.role, content: message.content };
      }),
      tools: request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: request.tools.length > 0 ? "auto" : undefined,
    };

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenAI gateway ${response.status}: ${detail.slice(0, 400) || response.statusText}`,
      );
    }

    const fragments = new Map<number, OpenAiToolCallFragment>();
    let stopReason: "end" | "tool_calls" | "length" = "end";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        let parsed: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: "text", text };

        for (const fragment of choice?.delta?.tool_calls ?? []) {
          const existing = fragments.get(fragment.index) ?? {
            index: fragment.index,
            args: "",
          };
          fragments.set(fragment.index, {
            index: fragment.index,
            id: fragment.id ?? existing.id,
            name: fragment.function?.name ?? existing.name,
            args: existing.args + (fragment.function?.arguments ?? ""),
          });
        }

        if (choice?.finish_reason === "tool_calls") stopReason = "tool_calls";
        if (choice?.finish_reason === "length") stopReason = "length";

        if (parsed.usage) {
          yield {
            type: "usage",
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
      }
    }

    for (const fragment of fragments.values()) {
      if (!fragment.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = fragment.args ? (JSON.parse(fragment.args) as Record<string, unknown>) : {};
      } catch {
        args = { _raw: fragment.args };
      }
      yield {
        type: "tool_call",
        call: {
          id: fragment.id ?? `call_${fragment.index}_${Date.now()}`,
          name: fragment.name,
          args,
        },
      };
    }

    yield { type: "done", stopReason };
  }
}
