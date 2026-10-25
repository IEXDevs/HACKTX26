import { describe, expect, it } from "vitest";
import { DraftSchema } from "./runtime/builder-parse";
import { draftFromNodes, graphFromNodes, nodesFromDraft, withoutBranch } from "./workflow-draft";

const worker = (name: string, parentIndex: number) => ({
  name, parentIndex, role: "worker", complexity: "standard", instructions: `Complete the work assigned to ${name}.`, tools: ["kb.search"],
});
const draft = DraftSchema.parse({
  name: "Lead", summary: "A nested workflow.", instructions: "Delegate the work to Research and Writer.",
  goal: "Research the topic and write a report.", complexity: "standard",
  workers: [worker("Research", -1), worker("Sources", 0), worker("Writer", -1)],
});

describe("workflow draft graph", () => {
  it("round-trips nested parent links between model drafts, the graph, and saving", () => {
    const nodes = nodesFromDraft(draft);
    const graph = graphFromNodes(nodes);
    expect(graph.map((node) => [node.id, node.parentAgentId])).toEqual([
      ["lead", null], ["worker-0", "lead"], ["worker-1", "worker-0"], ["worker-2", "lead"],
    ]);
    expect(DraftSchema.parse(draftFromNodes(nodes, draft.summary, draft.goal!))).toEqual(draft);
  });

  it("removes a branch and keeps the remaining tree connected", () => {
    const remaining = withoutBranch(nodesFromDraft(draft), "worker-0");
    expect(remaining.map((node) => node.name)).toEqual(["Lead", "Writer"]);
    expect(draftFromNodes(remaining, draft.summary, draft.goal!).workers[0]?.parentIndex).toBe(-1);
    expect(withoutBranch(remaining, "lead")).toEqual([]);
  });

  it("rejects cycles, missing parents, and trees below the supported rank floor", () => {
    for (const workers of [
      [worker("Self", 0)],
      [worker("Missing", 4)],
      [worker("One", -1), worker("Two", 0), worker("Three", 1), worker("Four", 2)],
    ]) expect(DraftSchema.safeParse({ ...draft, workers }).success).toBe(false);
  });
});
