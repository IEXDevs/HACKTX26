import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "@/lib/loop/test-support";
import { connectorsForAgent, listConnectorViews } from "./connectors";

describe("connector catalog", () => {
  beforeEach(freshDb);

  it("shows popular Composio apps and the SerpAPI web search tool", async () => {
    const { connectors } = await listConnectorViews({
      workspaceId: "ws_astronom",
      userId: "local:test",
    });
    const slugs = connectors.map((row) => row.slug);
    expect(slugs).toContain("github");
    expect(slugs).toContain("gmail");
    expect(slugs).toContain("slack");
    expect(slugs).toContain("serpapi");
    expect(connectors.find((row) => row.slug === "github")?.popular).toBe(true);
    expect(connectors.find((row) => row.slug === "serpapi")?.builtin).toBe(true);
  });

  it("lets people search the catalog", async () => {
    const { connectors } = await listConnectorViews({
      workspaceId: "ws_astronom",
      userId: "local:test",
      query: "slack",
    });
    expect(connectors.some((row) => row.slug === "slack")).toBe(true);
    expect(
      connectors.every(
        (row) =>
          row.slug.includes("slack") ||
          row.name.toLowerCase().includes("slack") ||
          row.description.toLowerCase().includes("slack"),
      ),
    ).toBe(true);
  });

  it("does not treat stored grunt grants as standing access", () => {
    expect(
      connectorsForAgent({ role: "worker" }, ["gmail", "github"]),
    ).toEqual([]);
    expect(connectorsForAgent({ role: "orchestrator" }, ["gmail", "github"])).toEqual([
      "gmail",
      "github",
    ]);
  });
});
