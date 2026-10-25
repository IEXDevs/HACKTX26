import { describe, expect, it } from "vitest";
import { DraftSchema, parseBuilderReply, parseSearchRequest } from "./builder-parse";

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

  it("keeps a first-run goal and drops a bad one without losing the draft", () => {
    const withGoal = { ...draft, goal: "Triage the ten newest tickets." };
    expect(parseBuilderReply(JSON.stringify({ reply: "Ok.", draft: withGoal })).draft?.goal).toBe(
      "Triage the ten newest tickets.",
    );
    const badGoal = parseBuilderReply(JSON.stringify({ reply: "Ok.", draft: { ...draft, goal: "go" } }));
    expect(badGoal.draft?.name).toBe("Support Lead");
    expect(badGoal.draft?.goal).toBeUndefined();
  });

  it("falls back to plain text when there is no JSON", () => {
    expect(parseBuilderReply("What should it do?")).toEqual({ reply: "What should it do?", draft: null });
  });
});

describe("draft apps", () => {
  it("defaults to no apps", () => {
    expect(parseBuilderReply(JSON.stringify({ reply: "Ok.", draft })).draft?.apps).toEqual([]);
  });

  it("normalizes slugs, drops duplicates, and keeps at most six", () => {
    const apps = [" GoogleCalendar ", "gmail", "googlecalendar", "", "slack", "notion", "linear", "jira", "github"];
    expect(DraftSchema.parse({ ...draft, apps }).apps).toEqual(["googlecalendar", "gmail", "slack", "notion", "linear", "jira"]);
  });

  it("drops a bad apps value without losing the draft", () => {
    const result = parseBuilderReply(JSON.stringify({ reply: "Ok.", draft: { ...draft, apps: "gmail" } }));
    expect(result.draft?.name).toBe("Support Lead");
    expect(result.draft?.apps).toEqual([]);
  });
});

describe("parseSearchRequest", () => {
  it("reads a search request", () => {
    expect(parseSearchRequest('{"search": "  composio google calendar  "}')).toBe("composio google calendar");
  });

  it("ignores replies, drafts, and empty queries", () => {
    expect(parseSearchRequest('{"reply":"Hi.","draft":null}')).toBeNull();
    expect(parseSearchRequest(JSON.stringify({ search: "gmail api", reply: "Ok.", draft }))).toBeNull();
    expect(parseSearchRequest('{"search": " "}')).toBeNull();
    expect(parseSearchRequest("plain text")).toBeNull();
  });
});
