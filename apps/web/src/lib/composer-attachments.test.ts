import { describe, expect, it } from "vitest";
import { applyAttachments, formatAttachmentPrefix } from "./composer-attachments";

describe("composer attachments", () => {
  it("prefixes the GitHub checkout so the agent knows what to work on", () => {
    expect(
      applyAttachments("Fix the pool ceiling.", [
        { kind: "github", repo: "acme/checkout", branch: "main" },
      ]),
    ).toBe(
      "Working GitHub repo: acme/checkout @ main. The checkout is under repo/ in the sandbox.\n\nFix the pool ceiling.",
    );
  });

  it("does nothing without attachments", () => {
    expect(formatAttachmentPrefix([])).toBe("");
    expect(applyAttachments("Hello", [])).toBe("Hello");
  });
});
