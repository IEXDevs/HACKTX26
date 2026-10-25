import { describe, expect, it } from "vitest";
import { MOTIVATOR_SYSTEM, reviewWithMotivator, type MotivatorReviewInput } from "./motivator";
import type { ModelChunk, ModelGateway, ModelRequest } from "./types";

const input: MotivatorReviewInput = {
  goal: "Find the requested course assignments.", proposal: "finish", candidate: "No information found.",
  availableTools: ["context.read", "web.search"], connectors: ["serpapi"],
  messages: [{ role: "system", content: "Original agent instructions." }, { role: "tool", content: "0 matches for the first query.", toolName: "kb.search" }], priorReviews: [],
};

function gateway(chunks: ModelChunk[], requests: ModelRequest[]): ModelGateway {
  return { id: "test", async *complete(request) { requests.push(request); for (const chunk of chunks) yield chunk; } };
}

describe("independent motivator review", () => {
  it("uses a separate tool-free prompt with the goal, evidence, capabilities, and prior advice", async () => {
    const requests: ModelRequest[] = [];
    const decision = { verdict: "continue", reason: "One empty query does not exhaust the available sources.", nextSteps: ["Use web.search to find the official course source."] };
    const result = await reviewWithMotivator({ ...input, priorReviews: [{ verdict: "continue", reason: "Check local notes first.", nextSteps: ["Read CONTEXT.md."] }] }, {
      model: "test", gateway: gateway([{ type: "text", text: JSON.stringify(decision) }, { type: "usage", inputTokens: 100, outputTokens: 40 }], requests),
    });
    expect(result).toMatchObject({ decision, inputTokens: 100, outputTokens: 40 });
    expect(requests[0]!.tools).toEqual([]);
    expect(requests[0]!.messages[0]).toEqual({ role: "system", content: MOTIVATOR_SYSTEM });
    const review = JSON.parse(requests[0]!.messages[1]!.content);
    expect(review).toMatchObject({ goal: input.goal, availableTools: input.availableTools, linkedConnectors: input.connectors });
    expect(review.evidence[0].text).toContain("0 matches");
    expect(review.priorReviews[0].reason).toContain("Check local notes");
    expect(requests[0]!.messages.some((message) => message.content === "Original agent instructions.")).toBe(false);
  });

  it.each([
    '{"verdict":"continue","reason":"Try harder","nextSteps":[]}',
    '{"verdict":"ask_user","reason":"Need a decision","nextSteps":[]}',
    "Not JSON",
  ])("does not accept an unsupported or malformed assessment", async (completion) => {
    const result = await reviewWithMotivator(input, { model: "test", gateway: gateway([{ type: "text", text: completion }], []) });
    expect(result.decision).toMatchObject({ verdict: "blocked", reason: expect.stringContaining("could not be independently verified") });
  });

  it("does not execute tool requests from the motivator", async () => {
    const result = await reviewWithMotivator(input, { model: "test", gateway: gateway([
      { type: "text", text: '{"verdict":"complete","reason":"Done","nextSteps":[]}' },
      { type: "tool_call", call: { id: "unexpected", name: "fs.write", args: {} } },
    ], []) });
    expect(result.decision.verdict).toBe("blocked");
  });
});
