import { describe, expect, it, vi } from "vitest";
import { askBuilder, BUILDER_RULES, BUILDER_SYSTEM, describeApps, MAX_BUILDER_SEARCHES } from "./builder";
import type { ModelGateway, ModelRequest } from "./types";

vi.mock("../observability", () => ({ recordModelTurn: vi.fn(async () => undefined) }));

const draft = {
  name: "Calendar Lead",
  summary: "Keeps the calendar tidy.",
  instructions: "Read the calendar each morning and flag double bookings.",
  complexity: "standard",
  apps: ["googlecalendar"],
  workers: [],
};

/** Replies with each scripted completion in turn and keeps every request it saw. */
function fakeGateway(completions: string[]) {
  const requests: ModelRequest[] = [];
  const gateway: ModelGateway = {
    id: "fake",
    async *complete(request) {
      requests.push({ ...request, messages: [...request.messages] });
      yield { type: "text", text: completions[requests.length - 1] ?? "" };
      yield { type: "usage", inputTokens: 10, outputTokens: 2 };
    },
  };
  return { gateway, requests };
}

const hit = { title: "Google Calendar | Composio", url: "https://composio.dev/toolkits/googlecalendar", snippet: "Events and invites." };
// Past the discovery reply, so a draft may come back.
const history = [
  { role: "user" as const, content: "Watch my calendar for double bookings." },
  { role: "assistant" as const, content: "Which calendar, and where should alerts go?" },
  { role: "user" as const, content: "My Google Calendar. Message me in Slack." },
];
const final = JSON.stringify({ reply: "Here is the agent.", draft });

describe("builder web search", () => {
  it("runs a search, hands back the results, and returns the searches made", async () => {
    const { gateway, requests } = fakeGateway(['{"search": "composio google calendar"}', final]);
    const search = vi.fn(async () => [hit]);
    const result = await askBuilder(history, { gateway, search });
    expect(search).toHaveBeenCalledWith("composio google calendar");
    expect(result.reply).toBe("Here is the agent.");
    expect(result.draft?.apps).toEqual(["googlecalendar"]);
    expect(result.searches).toEqual([{ query: "composio google calendar", hits: [hit] }]);
    expect(result).toMatchObject({ inputTokens: 20, outputTokens: 4 });
    const fed = requests[1]!.messages.at(-1)!;
    expect(fed.role).toBe("user");
    expect(fed.content).toContain(hit.url);
  });

  it(`stops searching after ${MAX_BUILDER_SEARCHES} searches and asks for an answer`, async () => {
    const ask = '{"search": "another query"}';
    const { gateway, requests } = fakeGateway([ask, ask, ask, final]);
    const search = vi.fn(async () => [hit]);
    const result = await askBuilder(history, { gateway, search });
    expect(search).toHaveBeenCalledTimes(MAX_BUILDER_SEARCHES);
    expect(result.searches).toHaveLength(MAX_BUILDER_SEARCHES);
    expect(requests[3]!.messages.at(-1)!.content).toContain("no longer available");
    expect(result.reply).toBe("Here is the agent.");
  });

  it("never loops past the limit when the model keeps asking", async () => {
    const ask = '{"search": "again"}';
    const { gateway, requests } = fakeGateway([ask, ask, ask, ask, ask]);
    const result = await askBuilder(history, { gateway, search: async () => [] });
    expect(requests).toHaveLength(MAX_BUILDER_SEARCHES + 2);
    expect(result.reply).toBeTruthy();
    expect(result.draft).toBeNull();
  });

  it("tells the model search is unavailable instead of failing the turn", async () => {
    const { gateway, requests } = fakeGateway(['{"search": "gmail mcp server"}', final]);
    const result = await askBuilder(history, {
      gateway,
      search: async () => { throw new Error("Web search is not configured."); },
    });
    expect(result.reply).toBe("Here is the agent.");
    expect(result.searches).toEqual([]);
    expect(requests[1]!.messages.at(-1)!.content).toContain("unavailable");
  });

  it("answers in one round when the model does not search", async () => {
    const { gateway, requests } = fakeGateway([final]);
    const search = vi.fn(async () => [hit]);
    const result = await askBuilder(history, { gateway, search });
    expect(requests).toHaveLength(1);
    expect(search).not.toHaveBeenCalled();
    expect(result.searches).toEqual([]);
  });
});

describe("builder rules", () => {
  it("are part of the text builder prompt", () => {
    for (const part of Object.values(BUILDER_RULES)) expect(BUILDER_SYSTEM).toContain(part);
    expect(BUILDER_RULES.apps).toContain("googlecalendar: Google Calendar");
  });

  it("names apps and marks the linked ones", () => {
    expect(describeApps(["googlecalendar", "acme"], ["googlecalendar"])).toEqual([
      { slug: "googlecalendar", name: "Google Calendar", linked: true },
      { slug: "acme", name: "acme", linked: false },
    ]);
  });
});
