import { describe, expect, it } from "vitest";
import { parseConnectorList, preferConnectedAccounts, resolveActionSlug } from "./composio";

describe("composio helpers", () => {
  it("parses connector lists", () => {
    expect(parseConnectorList("github, Gmail serpapi")).toEqual(["github", "gmail", "serpapi"]);
    expect(parseConnectorList(["GitHub", "github", " slack "])).toEqual(["github", "slack"]);
  });

  it("resolves action slugs", () => {
    expect(resolveActionSlug("github", "GITHUB_CREATE_AN_ISSUE")).toBe("GITHUB_CREATE_AN_ISSUE");
    expect(resolveActionSlug("github", "create_an_issue")).toBe("GITHUB_CREATE_AN_ISSUE");
  });

  it("keeps an active GitHub account over leftover expired attempts", () => {
    const picked = preferConnectedAccounts([
      {
        toolkit: "github",
        toolkitName: "GitHub",
        accountId: "ca_expired",
        status: "error",
        authConfigId: null,
      },
      {
        toolkit: "github",
        toolkitName: "GitHub",
        accountId: "ca_active",
        status: "connected",
        authConfigId: null,
      },
      {
        toolkit: "gmail",
        toolkitName: "Gmail",
        accountId: "ca_mail",
        status: "connected",
        authConfigId: null,
      },
    ]);
    expect(picked).toEqual([
      {
        toolkit: "github",
        toolkitName: "GitHub",
        accountId: "ca_active",
        status: "connected",
        authConfigId: null,
      },
      {
        toolkit: "gmail",
        toolkitName: "Gmail",
        accountId: "ca_mail",
        status: "connected",
        authConfigId: null,
      },
    ]);
  });
});
