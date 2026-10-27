import { describe, expect, it } from "vitest";
import { builderStorageKey, readBuilderAutosave } from "./builder-autosave";

describe("builder autosave", () => {
  it("restores unsent text, chat, and publish options together", () => {
    const value = { version: 1, input: "Next edit", messages: [{ id: "m3", from: "you", text: "Build an agent" }], draft: null, canSpawnSubagents: false, proposeTemplates: true, attachments: [{ kind: "app", slug: "gmail", name: "Gmail" }] };
    expect(readBuilderAutosave(JSON.stringify(value))).toEqual(value);
  });
  it("separates accounts and modes and ignores damaged saves", () => {
    expect(builderStorageKey("a")).not.toBe(builderStorageKey("b"));
    expect(builderStorageKey("a", "automatic")).not.toBe(builderStorageKey("a"));
    expect(readBuilderAutosave("{broken")).toBeNull();
    expect(readBuilderAutosave('{"version":2}')).toBeNull();
  });
});
