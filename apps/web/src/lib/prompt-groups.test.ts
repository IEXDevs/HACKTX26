import { describe, expect, it } from "vitest";
import { groupPromptLogs } from "./prompt-groups";
import type { CloudPromptRow } from "./observability";

const row = (id: string, runId: string | null, time: number, source: CloudPromptRow["source"] = "run"): CloudPromptRow => ({ id, runId, source, agentId: "agent", model: "test", step: time, messages: [], completion: "result", inputTokens: 2, outputTokens: 3, createdAt: new Date(time) });
describe("prompt trace groups", () => {
  it("groups interleaved turns by run, newest run first and turns in time order", () => {
    const groups = groupPromptLogs([row("a2", "a", 5), row("b1", "b", 4), row("a1", "a", 1)]);
    expect(groups.map((group) => group.runId)).toEqual(["a", "b"]);
    expect(groups[0]!.rows.map((turn) => turn.id)).toEqual(["a1", "a2"]);
    expect(groups[0]!.tokens).toBe(10);
  });
  it("keeps builder and composition traces without run IDs accessible", () => {
    expect(groupPromptLogs([row("chat", null, 2, "builder"), row("compose", null, 1, "compose")]).map((group) => group.id)).toEqual(["source:builder", "source:compose"]);
  });
});
