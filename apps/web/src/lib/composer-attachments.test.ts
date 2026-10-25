import { describe, expect, it } from "vitest";
import { applyAttachments, formatAttachmentPrefix } from "./composer-attachments";

describe("composer attachments", () => {
  it("prefixes the GitHub checkout so the agent knows what to work on", () => {
    expect(
      applyAttachments("Fix the pool ceiling.", [
        { kind: "github", repo: "acme/checkout", branch: "main" },
      ]),
    ).toBe(
      "Working GitHub repo: acme/checkout @ main. The checkout is under repo/ in the sandbox. Use it for this job.\n\nFix the pool ceiling.",
    );
  });

  it("names other linked apps so the agent can use them", () => {
    expect(
      applyAttachments("Check the inbox.", [{ kind: "app", slug: "gmail", name: "Gmail" }]),
    ).toBe("Use the linked Gmail connection (gmail) for this job when it helps.\n\nCheck the inbox.");
  });

  it("does nothing without attachments", () => {
    expect(formatAttachmentPrefix([])).toBe("");
    expect(applyAttachments("Hello", [])).toBe("Hello");
  });
});
