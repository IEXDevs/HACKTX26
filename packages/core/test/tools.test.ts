import { describe, expect, it } from "vitest";
import {
  TOOL_BY_NAME,
  connectorActionRisk,
  isConnectorWriteAction,
} from "../src/protocol/tools";

describe("connector actions", () => {
  it("treats list/get/search as reads", () => {
    expect(isConnectorWriteAction("GITHUB_LIST_PULL_REQUESTS")).toBe(false);
    expect(isConnectorWriteAction("GMAIL_GET_PROFILE")).toBe(false);
    expect(isConnectorWriteAction("SLACK_SEARCH_MESSAGES")).toBe(false);
    expect(connectorActionRisk("NOTION_FETCH_PAGE")).toBe("medium");
  });

  it("treats create/send/delete as writes", () => {
    expect(isConnectorWriteAction("GITHUB_CREATE_AN_ISSUE")).toBe(true);
    expect(isConnectorWriteAction("GMAIL_SEND_EMAIL")).toBe(true);
    expect(isConnectorWriteAction("SLACK_DELETE_MESSAGE")).toBe(true);
    expect(connectorActionRisk("LINEAR_CREATE_ISSUE")).toBe("high");
  });

  it("fails closed on unknown or mixed verbs", () => {
    expect(isConnectorWriteAction("GITHUB_FORK_REPOSITORY")).toBe(true);
    expect(isConnectorWriteAction("NOTION_APPEND_BLOCK_CHILDREN")).toBe(true);
    expect(isConnectorWriteAction("GMAIL_MODIFY_THREAD_LABELS")).toBe(true);
    expect(isConnectorWriteAction("GOOGLEDRIVE_COPY_FILE")).toBe(true);
    expect(isConnectorWriteAction("GITHUB_SEARCH_AND_CREATE")).toBe(true);
    expect(isConnectorWriteAction("")).toBe(true);
  });

  it("registers connector.call and web.search", () => {
    expect(TOOL_BY_NAME.get("connector.call")?.category).toBe("connector");
    expect(TOOL_BY_NAME.get("web.search")?.category).toBe("network");
  });
});
