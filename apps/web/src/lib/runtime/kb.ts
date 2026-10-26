/**
 * The workspace knowledge base behind `kb.search`.
 *
 * Documents are whatever people add. Nothing is preloaded. Retrieval is plain
 * lexical ranking, and every hit is labeled untrusted: retrieved text is where
 * prompt injection arrives, so it is never treated as an instruction.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { DataClass } from "@agent-os/core";
import { getDb } from "../db/client";
import { kbDocuments } from "../db/schema";
import { newId } from "../env";

export interface KbDocument {
  id: string;
  title: string;
  dataClass: DataClass;
  body: string;
}

export interface KbHit {
  id: string;
  title: string;
  dataClass: DataClass;
  score: number;
  snippet: string;
  trust: "untrusted";
}

const CLASS_ORDER: readonly DataClass[] = ["public", "internal", "confidential", "restricted"];

/** A reader cleared for `ceiling` may see documents at that class or below. */
export function classAllows(ceiling: DataClass, documentClass: DataClass): boolean {
  return CLASS_ORDER.indexOf(documentClass) <= CLASS_ORDER.indexOf(ceiling);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

/** Lexical ranking over a set of documents. No embeddings, no hidden magic. */
export function rankDocuments(docs: readonly KbDocument[], query: string, topK = 4): KbHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  return docs
    .map((doc) => {
      const haystack = `${doc.title} ${doc.body}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const occurrences = haystack.split(term).length - 1;
        if (occurrences > 0) score += 1 + Math.log(occurrences);
        if (doc.title.toLowerCase().includes(term)) score += 1.5;
      }
      const normalized = score / (terms.length * 2.5);

      const lowerBody = doc.body.toLowerCase();
      const firstHit = terms
        .map((term) => lowerBody.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
      const start = firstHit === undefined ? 0 : Math.max(0, firstHit - 120);
      const snippet =
        doc.body.slice(start, start + 360).replace(/\s+/g, " ").trim() +
        (doc.body.length > start + 360 ? "…" : "");

      return {
        id: doc.id,
        title: doc.title,
        dataClass: doc.dataClass,
        score: Number(normalized.toFixed(3)),
        snippet,
        trust: "untrusted" as const,
      };
    })
    .filter((hit) => hit.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function listKbDocuments(workspaceId: string) {
  return (await getDb())
    .select({
      id: kbDocuments.id,
      title: kbDocuments.title,
      dataClass: kbDocuments.dataClass,
      addedBy: kbDocuments.addedBy,
      createdAt: kbDocuments.createdAt,
      characters: sql<number>`length(${kbDocuments.body})`,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.workspaceId, workspaceId))
    .orderBy(desc(kbDocuments.createdAt));
}

export async function countKbDocuments(workspaceId: string): Promise<number> {
  const [row] = await (await getDb())
    .select({ total: count() })
    .from(kbDocuments)
    .where(eq(kbDocuments.workspaceId, workspaceId));
  return row?.total ?? 0;
}

/**
 * Search the workspace's documents. When `dataClass` is given, documents above
 * it are left out: an agent never reads a source above its own data class.
 */
export async function searchKnowledgeBase(
  workspaceId: string,
  query: string,
  options: { topK?: number; dataClass?: DataClass } = {},
): Promise<KbHit[]> {
  const rows = await (await getDb()).select().from(kbDocuments).where(eq(kbDocuments.workspaceId, workspaceId));
  const visible = options.dataClass
    ? rows.filter((row) => classAllows(options.dataClass!, row.dataClass))
    : rows;
  return rankDocuments(visible, query, options.topK ?? 4);
}

export async function addKbDocument(input: {
  workspaceId: string;
  title: string;
  body: string;
  dataClass: DataClass;
  addedBy: string;
}): Promise<string> {
  const id = newId("kb");
  await (await getDb()).insert(kbDocuments).values({
    id,
    workspaceId: input.workspaceId,
    title: input.title,
    body: input.body,
    dataClass: input.dataClass,
    addedBy: input.addedBy,
    createdAt: new Date(),
  });
  return id;
}

export async function removeKbDocument(workspaceId: string, id: string): Promise<boolean> {
  const removed = await (await getDb())
    .delete(kbDocuments)
    .where(and(eq(kbDocuments.workspaceId, workspaceId), eq(kbDocuments.id, id)))
    .returning({ id: kbDocuments.id });
  return removed.length > 0;
}
