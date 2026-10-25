import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "./types";
import { askBuilder } from "./builder";

const state = vi.hoisted(() => ({ completion: "", requests: [] as ModelRequest[] }));
vi.mock("./gateway", () => ({
  liveGatewayAvailable: () => true,
  createLiveGateway: () => ({ async *complete(request: ModelRequest) {
    state.requests.push(request);
    yield { type: "text", text: state.completion };
  } }),
}));

const draft = { name: "Course helper", summary: "Summarizes assignments.",
  instructions: "Read the selected course assignments and return a Markdown report sorted by due date.",
  goal: "Summarize this week's CS 314 assignments.", complexity: "standard", workers: [] };
const question = "Which courses should it include, and where should the report go?";

describe("agent creator discovery", () => {
  beforeEach(() => { state.completion = ""; state.requests.length = 0; });

  it("keeps a first-turn model draft out of the Publish flow", async () => {
    state.completion = JSON.stringify({ reply: "Publish this agent.", draft });
    const result = await askBuilder([{ role: "user", content: "Make a course helper." }]);
    expect(result.draft).toBeNull();
    expect(result.reply).toContain("which sources or apps");
    expect(result.reply).not.toContain("Publish this agent");
  });

  it("keeps the model's targeted first question without showing a draft", async () => {
    state.completion = JSON.stringify({ reply: question, draft: null });
    const result = await askBuilder([{ role: "user", content: "Make a course helper." }]);
    expect(result).toMatchObject({ reply: question, draft: null });
    expect(state.requests[0]!.messages[0]!.content).toContain("initial discovery reply");
    expect(state.requests[0]!.tools).toEqual([]);
  });

  it("can draft after the person supplies the requested details", async () => {
    state.completion = JSON.stringify({ reply: "This uses Canvas for CS 314 and returns a Markdown report. It will not submit assignments.", draft });
    const result = await askBuilder([
      { role: "user", content: "Make a course helper." },
      { role: "assistant", content: question },
      { role: "user", content: "Only CS 314 in Canvas. Return Markdown here, sorted by due date. Never submit anything." },
    ]);
    expect(result.draft).toMatchObject(draft);
    expect(state.requests[0]!.messages.at(-1)!.content).toContain("Never submit anything");
  });

  it("can ask another useful question after the first answer instead of forcing a draft", async () => {
    state.completion = JSON.stringify({ reply: "Should completed assignments stay out of the report?", draft: null });
    const result = await askBuilder([
      { role: "user", content: "Make a course helper." },
      { role: "assistant", content: question },
      { role: "user", content: "CS 314 in Canvas. A report here." },
    ]);
    expect(result.draft).toBeNull();
    expect(result.reply).toContain("completed assignments");
  });

  it("edits a supplied graph draft without restarting discovery", async () => {
    state.completion = JSON.stringify({ reply: "Updated the report scope.", draft });
    const result = await askBuilder([{ role: "user", content: "Change the report to CS 314 only." }], { draft: JSON.stringify(draft), workflowMode: "automatic" });
    expect(result.draft?.name).toBe(draft.name);
  });
});
