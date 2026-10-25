import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("drops Markdown markup for one-line summaries", () => {
    const md = "## Root cause\n\n- **POOL_MAX** fell from `40` to 10.\n- See [the runbook](https://x.test).";
    expect(plainText(md)).toBe("Root cause POOL_MAX fell from 40 to 10. See the runbook.");
  });
  it("keeps dollar amounts and plain sentences unchanged", () => {
    expect(plainText("Spent $0.25 of $2.00.")).toBe("Spent $0.25 of $2.00.");
    expect(plainText("Rotated the key and verified 214 tests.")).toBe("Rotated the key and verified 214 tests.");
  });
});
