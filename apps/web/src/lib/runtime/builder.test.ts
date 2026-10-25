import { describe, expect, it } from "vitest";
import { parseBuilderReply } from "./builder-parse";

const draft = {
  name: "Support Lead",
  summary: "Answers support tickets.",
  instructions: "Classify each ticket, draft a reply, and route escalations.",
  complexity: "standard",
  workers: [
    { name: "Classifier", role: "worker", instructions: "Label each ticket.", complexity: "trivial", tools: ["kb.search"] },
  ],
};

describe("parseBuilderReply", () => {
  it("reads a reply without a draft", () => {
    expect(parseBuilderReply('{"reply":"Who reads the answers?","draft":null}')).toEqual({
      reply: "Who reads the answers?",
      draft: null,
    });
  });

  it("reads a valid draft wrapped in extra text", () => {
    const result = parseBuilderReply(`Sure.\n${JSON.stringify({ reply: "Here it is.", draft })}`);
    expect(result.reply).toBe("Here it is.");
    expect(result.draft?.name).toBe("Support Lead");
    expect(result.draft?.workers[0]?.tools).toEqual(["kb.search"]);
  });

  it("drops a draft that fails validation", () => {
    const bad = { ...draft, instructions: "short" };
    expect(parseBuilderReply(JSON.stringify({ reply: "Done.", draft: bad })).draft).toBeNull();
  });

  it("falls back to plain text when there is no JSON", () => {
    expect(parseBuilderReply("What should it do?")).toEqual({ reply: "What should it do?", draft: null });
  });
});
