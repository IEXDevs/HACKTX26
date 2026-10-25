import { describe, expect, it } from "vitest";
import { parseConnectorList, resolveActionSlug } from "./composio";

describe("composio helpers", () => {
  it("parses connector lists", () => {
    expect(parseConnectorList("github, Gmail serpapi")).toEqual(["github", "gmail", "serpapi"]);
    expect(parseConnectorList(["GitHub", "github", " slack "])).toEqual(["github", "slack"]);
  });

  it("resolves action slugs", () => {
    expect(resolveActionSlug("github", "GITHUB_CREATE_AN_ISSUE")).toBe("GITHUB_CREATE_AN_ISSUE");
    expect(resolveActionSlug("github", "create_an_issue")).toBe("GITHUB_CREATE_AN_ISSUE");
  });
});
