import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { seedPlatform } from "@/lib/db/seed";
import {
  addKbDocument,
  classAllows,
  countKbDocuments,
  listKbDocuments,
  rankDocuments,
  removeKbDocument,
  searchKnowledgeBase,
  type KbDocument,
} from "./kb";

const WS = "ws_astronom";

const docs: KbDocument[] = [
  {
    id: "d1",
    title: "Refund policy",
    dataClass: "internal",
    body: "Refunds over 500 dollars need a manager. Refund requests close after thirty days.",
  },
  {
    id: "d2",
    title: "Office hours",
    dataClass: "public",
    body: "The office is open from nine to five on weekdays.",
  },
];

async function freshPlatform() {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  (await getDb());
  await seedPlatform();
}

describe("ranking", () => {
  it("puts the best match first", () => {
    const hits = rankDocuments(docs, "refund requests manager", 3);
    expect(hits[0]?.id).toBe("d1");
  });

  it("labels every retrieved chunk as untrusted", () => {
    const hits = rankDocuments(docs, "office hours", 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.trust === "untrusted")).toBe(true);
  });

  it("returns no hits instead of inventing a match", () => {
    expect(rankDocuments(docs, "")).toEqual([]);
    expect(rankDocuments(docs, "quantum-flux-capacitor")).toEqual([]);
  });
});

describe("data classes", () => {
  it("lets a reader see its own class and below, never above", () => {
    expect(classAllows("internal", "public")).toBe(true);
    expect(classAllows("internal", "internal")).toBe(true);
    expect(classAllows("internal", "confidential")).toBe(false);
    expect(classAllows("restricted", "confidential")).toBe(true);
  });
});

describe("workspace documents", () => {
  beforeEach(freshPlatform);

  it("starts empty: nothing is preloaded", async () => {
    expect(await countKbDocuments(WS)).toBe(0);
    expect(await searchKnowledgeBase(WS, "runbook policy contract")).toEqual([]);
  });

  it("finds a document that someone added, and forgets it once removed", async () => {
    const id = await addKbDocument({
      workspaceId: WS,
      title: "Refund policy",
      body: "Refunds over 500 dollars need a manager.",
      dataClass: "internal",
      addedBy: "ada@example.com",
    });

    const listed = await listKbDocuments(WS);
    expect(listed.map((d) => d.id)).toEqual([id]);
    expect(Number(listed[0]?.characters)).toBe("Refunds over 500 dollars need a manager.".length);

    const hits = await searchKnowledgeBase(WS, "refund manager");
    expect(hits.map((h) => h.id)).toEqual([id]);

    expect(await removeKbDocument(WS, id)).toBe(true);
    expect(await removeKbDocument(WS, id)).toBe(false);
    expect(await searchKnowledgeBase(WS, "refund manager")).toEqual([]);
  });

  it("hides documents above the reader's data class", async () => {
    await addKbDocument({
      workspaceId: WS,
      title: "Salary bands",
      body: "Salary bands for engineering levels.",
      dataClass: "confidential",
      addedBy: "ada@example.com",
    });

    expect(await searchKnowledgeBase(WS, "salary bands", { dataClass: "internal" })).toEqual([]);
    expect(await searchKnowledgeBase(WS, "salary bands", { dataClass: "confidential" })).toHaveLength(1);
  });
});
