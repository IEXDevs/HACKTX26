import { describe, expect, it } from "vitest";
import { composeAgentScripted, extractJson } from "./compose-agent";

describe("use-case composer", () => {
  const useCase =
    "Build an agent that reviews the Acme vendor MSA, flags renewal and liability clauses, and writes a confidential summary for legal.";

  it("writes a standing system prompt and a separate goal", () => {
    const draft = composeAgentScripted(useCase);
    expect(draft.role).toBe("orchestrator");
    expect(draft.instructions).toContain("Operating rules");
    expect(draft.instructions).not.toBe(draft.goal);
    expect(draft.goal.toLowerCase()).toContain("acme vendor msa");
    expect(draft.goal.length).toBeGreaterThan(8);
  });

  it("autofills classification, complexity, and tools from the request", () => {
    const draft = composeAgentScripted(useCase);
    expect(draft.dataClass).toBe("confidential");
    expect(draft.complexity).toBe("complex");
    expect(draft.allowedTools).toContain("kb.search");
    expect(draft.allowedTools).toContain("fs.write");
    expect(draft.allowedTools).not.toContain("shell.exec");
    expect(draft.summary.toLowerCase().startsWith("build an agent")).toBe(false);
    expect(draft.name.length).toBeGreaterThan(1);
  });

  it("keeps a shell-heavy incident on the critical path without dropping retrieval", () => {
    const draft = composeAgentScripted(
      "After the production deploy, checkout p95 is 4.2s. Run the tests and shell commands in the sandbox and write the mitigation.",
    );
    expect(draft.complexity).toBe("critical");
    expect(draft.allowedTools).toContain("shell.exec");
    expect(draft.allowedTools).toContain("kb.search");
  });

  it("extracts a JSON object from a fenced model reply", () => {
    const parsed = extractJson('```json\n{"name":"Checkout Watch","goal":"Restore latency."}\n```');
    expect(parsed).toMatchObject({ name: "Checkout Watch" });
  });
});
