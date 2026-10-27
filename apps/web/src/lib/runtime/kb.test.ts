import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { seedPlatform } from "@/lib/db/seed";
import { kbDocuments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
const ACCOUNT = "ada@example.com";

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
    expect(await countKbDocuments(WS, ACCOUNT)).toBe(0);
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

    const listed = await listKbDocuments(WS, ACCOUNT);
    expect(listed.map((d) => d.id)).toEqual([id]);
    expect(listed[0]).not.toHaveProperty("body");
    const [stored] = await (await getDb()).select().from(kbDocuments).where(eq(kbDocuments.id, id));
    expect(stored!.body).toMatch(/^sealed-document:v1:/);
    expect(stored!.body).not.toContain("Refunds over 500 dollars need a manager.");

    const hits = await searchKnowledgeBase(WS, "refund manager", { accountId: ACCOUNT });
    expect(hits.map((h) => h.id)).toEqual([id]);

    expect(await removeKbDocument(WS, id, ACCOUNT)).toBe(true);
    expect(await removeKbDocument(WS, id, ACCOUNT)).toBe(false);
    expect(await searchKnowledgeBase(WS, "refund manager", { accountId: ACCOUNT })).toEqual([]);
  });

  it("hides documents above the reader's data class", async () => {
    await addKbDocument({
      workspaceId: WS,
      title: "Salary bands",
      body: "Salary bands for engineering levels.",
      dataClass: "confidential",
      addedBy: "ada@example.com",
    });

    expect(await searchKnowledgeBase(WS, "salary bands", { accountId: ACCOUNT, dataClass: "internal" })).toEqual([]);
    expect(await searchKnowledgeBase(WS, "salary bands", { accountId: ACCOUNT, dataClass: "confidential" })).toHaveLength(1);
  });

  it("isolates listing, search, counts, and deletion by account", async () => {
    const mine = await addKbDocument({ workspaceId: WS, title: "A", body: "Private lunar launch instructions", dataClass: "internal", addedBy: ACCOUNT });
    const theirs = await addKbDocument({ workspaceId: WS, title: "A", body: "Private lunar launch instructions", dataClass: "internal", addedBy: "other-account" });
    expect((await listKbDocuments(WS, ACCOUNT)).map((row) => row.id)).toEqual([mine]);
    expect(await countKbDocuments(WS, ACCOUNT)).toBe(1);
    expect((await searchKnowledgeBase(WS, "lunar launch", { accountId: ACCOUNT })).map((row) => row.id)).toEqual([mine]);
    expect(await searchKnowledgeBase(WS, "lunar launch")).toEqual([]);
    expect(await removeKbDocument(WS, theirs, ACCOUNT)).toBe(false);
    expect(await countKbDocuments(WS, "other-account")).toBe(1);
    expect(await removeKbDocument(WS, mine, ACCOUNT)).toBe(true);
  });
});
