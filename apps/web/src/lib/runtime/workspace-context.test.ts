import { describe, expect, it } from "vitest";
import { upsertConnectedToolsSection } from "./workspace-context";

describe("connected tools section", () => {
  it("appends a marked block the first time", () => {
    const next = upsertConnectedToolsSection("# Workspace\n", "## Connected tools\n- GitHub");
    expect(next).toContain("<!-- astronom-connectors:start -->");
    expect(next).toContain("- GitHub");
  });

  it("replaces an existing block without duplicating it", () => {
    const first = upsertConnectedToolsSection("# Workspace\n", "## Connected tools\n- GitHub");
    const second = upsertConnectedToolsSection(first, "## Connected tools\n- Slack");
    expect(second).toContain("- Slack");
    expect(second).not.toContain("- GitHub");
    expect(second.split("astronom-connectors:start").length).toBe(2);
  });
});
