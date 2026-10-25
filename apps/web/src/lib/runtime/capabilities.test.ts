import { describe, expect, it } from "vitest";
import {
  closedRosterNames,
  delegateAgentName,
  delegateToolDescription,
  heldToolNames,
  isProbeLead,
  type CapabilityAgent,
} from "./capabilities";

function agent(overrides: Partial<CapabilityAgent> = {}): CapabilityAgent {
  return {
    name: "Red Team",
    role: "security",
    rank: "intermediate",
    team: "red",
    allowedTools: ["http.fetch", "fs.read", "fs.write", "fs.list", "context.read", "agent.delegate"],
    ...overrides,
  };
}

describe("heldToolNames", () => {
  it("does not advertise context.write just because the agent can write files", () => {
    const names = heldToolNames(agent(), [], "confidential");
    expect(names.has("context.write")).toBe(false);
    expect(names.has("context.read")).toBe(true);
    expect(names.has("fs.write")).toBe(true);
    expect(names.has("agent.delegate")).toBe(true);
    expect(names.has("security.report")).toBe(true);
  });

  it("advertises context.write for orchestrators even without it in allowedTools", () => {
    const names = heldToolNames(
      agent({
        name: "Incident Commander",
        role: "orchestrator",
        rank: "orchestrator",
        team: null,
        allowedTools: ["fs.read", "fs.write"],
      }),
      [],
      "internal",
    );
    expect(names.has("context.write")).toBe(true);
    expect(names.has("context.read")).toBe(true);
  });

  it("keeps context.write when it was granted explicitly", () => {
    const names = heldToolNames(
      agent({
        name: "Incident Commander",
        role: "orchestrator",
        rank: "orchestrator",
        team: null,
        allowedTools: ["context.read", "context.write"],
      }),
      [],
      "internal",
    );
    expect(names.has("context.write")).toBe(true);
  });
});

describe("red team roster", () => {
  it("treats Red Team as a probe lead with a closed specialist list", () => {
    expect(isProbeLead(agent())).toBe(true);
    expect(isProbeLead(agent({ name: "Injection Prober", rank: "grunt" }))).toBe(false);
    expect(closedRosterNames(agent())).toBe("Injection Prober, Escalation Prober, Egress Prober");
    expect(delegateToolDescription(agent())).toContain("Injection Prober");
    expect(delegateToolDescription(agent())).toContain("Do not invent other agents");
  });

  it("reads the specialist name from agent, name, or specialist", () => {
    expect(delegateAgentName({ agent: "Injection Prober" })).toBe("Injection Prober");
    expect(delegateAgentName({ name: "Escalation Prober" })).toBe("Escalation Prober");
    expect(delegateAgentName({ specialist: "Egress Prober" })).toBe("Egress Prober");
    expect(delegateAgentName({ agent: { name: "Injection Prober" } })).toBe("Injection Prober");
    expect(delegateAgentName({})).toBeNull();
  });
});
