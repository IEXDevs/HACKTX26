import { describe, expect, it } from "vitest";
import { TOOL_ARGUMENT_SCHEMAS, parametersForTool } from "../src/protocol/tool-parameters";
import { TOOL_MANIFEST } from "../src/protocol/tools";

const examples: Record<keyof typeof TOOL_ARGUMENT_SCHEMAS, Record<string, unknown>> = {
  "fs.list": {}, "fs.read": { path: "a.txt" }, "fs.write": { path: "a.txt", content: "hello" }, "fs.delete": { path: "a.txt" },
  "shell.exec": { command: "node check.js" }, "cli.run": { command: "git status" }, "http.fetch": { url: "https://github.com" },
  "kb.search": { query: "notes", topK: 4 }, "memory.write": { content: "a fact", scope: "agent", kind: "fact" }, "memory.search": {},
  "context.read": {}, "context.write": { include: "a fact" }, "task.handoff": { summary: "done" },
  "user.ask": { question: "Which course?", reason: "Two matches" }, "motivator.report": { blocker: "No matches", attempts: ["Searched"] },
  "agent.delegate": { agent: "Reader", task: "Read notes", tools: ["fs.read"], connectors: ["github"] },
  "security.report": { severity: "high", category: "injection", title: "Finding", detail: "Evidence" },
  "connector.call": { toolkit: "github", action: "GITHUB_LIST_REPOSITORIES", arguments: { page: 2 }, custom: true },
  "web.search": { query: "notes", num: 5 }, "mcp.call": { server: "local", tool: "read", args: { path: "a.txt" } }, "secret.use": { credential: "key" },
};

describe("tool argument contracts", () => {
  it.each(Object.entries(examples))("accepts supported arguments for %s", (name, args) => {
    expect(TOOL_ARGUMENT_SCHEMAS[name as keyof typeof TOOL_ARGUMENT_SCHEMAS].safeParse(args).success).toBe(true);
    expect(TOOL_MANIFEST.find((tool) => tool.name === name)?.parameters).toEqual(parametersForTool(name));
  });
  it("rejects invalid required fields and preserves arbitrary connector payloads", () => {
    expect(TOOL_ARGUMENT_SCHEMAS["fs.write"].safeParse({ path: 42 }).success).toBe(false);
    expect(TOOL_ARGUMENT_SCHEMAS["agent.delegate"].safeParse({ agent: "Reader", task: "Read", tools: "fs.read" }).success).toBe(false);
    expect(TOOL_ARGUMENT_SCHEMAS["connector.call"].parse(examples["connector.call"])).toEqual(examples["connector.call"]);
  });
  it("keeps schemas specific and substantially smaller than the previous shared argument object", () => {
    const fields = "path content command url query question reason blocker attempts evidence remainingOptions credential agent title task model complexity include remove summary scope kind severity category detail remediation case note instructions rule reply removeTools toolkit action arguments connectors engine num".split(" ");
    const properties = Object.fromEntries(fields.map((name) => [name, { type: "string" }]));
    const legacy = JSON.stringify(TOOL_MANIFEST.map((tool) => ({ ...tool, parameters: { type: "object", properties, additionalProperties: true } })));
    const current = JSON.stringify(TOOL_MANIFEST);
    expect(current.length).toBeLessThan(legacy.length * 0.6);
    expect(parametersForTool("fs.read").properties).toEqual({ path: { type: "string" } });
    expect(() => parametersForTool("missing")).toThrow("No argument schema");
  });
});
