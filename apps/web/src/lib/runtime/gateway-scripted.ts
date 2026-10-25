import type { ModelChunk, ModelGateway, ModelRequest } from "./types";
import type { ScriptStep } from "./scripts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function estimateTokens(text: string): number {
  // ~4 chars/token is accurate enough for budgeting a scripted run.
  return Math.max(1, Math.round(text.length / 4));
}

function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    current += word;
    if (current.length >= 22) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface ScriptedOptions {
  /** Per-chunk delay, so a local run still streams like a live one. */
  chunkDelayMs?: number;
  /** Deterministic variations keyed off this value. */
  seed?: string;
}

/**
 * Replays a plan as if a model were producing it, but hands every tool call to
 * the real executor. Deterministic: same plan + same seed, same event stream.
 */
export class ScriptedGateway implements ModelGateway {
  readonly id = "scripted";
  #cursor = 0;

  constructor(
    private readonly steps: readonly ScriptStep[],
    private readonly options: ScriptedOptions = {},
  ) {}

  get exhausted(): boolean {
    return this.#cursor >= this.steps.length;
  }

  async *complete(request: ModelRequest): AsyncIterable<ModelChunk> {
    const delay = this.options.chunkDelayMs ?? 18;
    const step = this.steps[this.#cursor];

    const inputTokens = estimateTokens(
      request.messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
    );

    if (!step) {
      const final = "No further steps are available for this task. Returning control.";
      for (const chunk of chunkText(final)) {
        if (delay > 0) await sleep(delay);
        yield { type: "text", text: chunk };
      }
      yield { type: "usage", inputTokens, outputTokens: estimateTokens(final) };
      yield { type: "done", stopReason: "end" };
      return;
    }

    this.#cursor += 1;

    for (const chunk of chunkText(step.say)) {
      if (delay > 0) await sleep(delay);
      yield { type: "text", text: chunk };
    }

    yield {
      type: "usage",
      inputTokens,
      outputTokens: estimateTokens(step.say),
    };

    if (step.tool) {
      yield {
        type: "tool_call",
        call: {
          id: `${request.model}:${this.#cursor}:${Math.random().toString(36).slice(2, 8)}`,
          name: step.tool.name,
          args: step.tool.args,
        },
      };
      yield { type: "done", stopReason: "tool_calls" };
      return;
    }

    yield { type: "done", stopReason: "end" };
  }
}
