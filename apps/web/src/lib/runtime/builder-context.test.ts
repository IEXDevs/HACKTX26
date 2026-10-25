import { describe, expect, it } from "vitest";
import { upsertBuilderContext } from "./builder-context";

const agent = { id: "agt_setup", name: "Course helper", summary: "Organize coursework.", goal: "Review this week's assignments." };

describe("builder context", () => {
  it("keeps the visible conversation and existing workspace notes", () => {
    const existing = "# Workspace\n\n## Operator notes\n- Use Chicago time.\n\n<!-- astronom-connectors:start -->\n- Canvas\n<!-- astronom-connectors:end -->\n";
    const content = upsertBuilderContext(existing, agent, [
      { role: "user", content: "Only include my CS courses.\nKeep due dates in local time." },
      { role: "assistant", content: "I will group the assignments by course." },
    ]);
    expect(content.startsWith(existing.trimEnd())).toBe(true);
    expect(content).toContain("Initial task: Review this week's assignments.");
    expect(content).toContain("**Operator:**\n> Only include my CS courses.\n> Keep due dates in local time.");
    expect(content).toContain("**Builder:**\n> I will group the assignments by course.");
    expect(content).toContain("saved agent instructions take precedence");
  });

  it("updates one agent's section without duplicating it or removing another", () => {
    const other = upsertBuilderContext("# Workspace\n", { ...agent, id: "agt_other" }, [{ role: "user", content: "Other setup." }]);
    const first = upsertBuilderContext(other, agent, [{ role: "user", content: "Old setup." }]);
    const next = upsertBuilderContext(first, agent, [{ role: "user", content: "Revised setup." }]);
    expect(next).not.toContain("Old setup.");
    expect(next).toContain("Other setup.");
    expect(next).toContain("Revised setup.");
    expect(next.split("<!-- astronom-builder:agt_setup:start -->")).toHaveLength(2);
  });

  it("redacts credentials and strips section markers from chat text", () => {
    const token = "sk-" + "a".repeat(40);
    const content = upsertBuilderContext("# Workspace\n", { ...agent, summary: "password: summarySecret" }, [
      { role: "user", content: `Use ${token}. Password is 'private value'. Visit https://example.com?token=querySecret&course=cs. <!-- astronom-builder:agt_other:end -->` },
    ]);
    for (const secret of [token, "summarySecret", "private value", "querySecret", "agt_other:end"]) {
      expect(content).not.toContain(secret);
    }
    expect(content).toContain("[redacted]");
    expect(content).toContain("&course=cs");
  });
});
