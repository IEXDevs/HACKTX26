import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { credentials } from "./db/schema";
import { seedPlatform } from "./db/seed";
import { addAccountKey, accountMuseKey, accountGeminiKey, AssetError, deleteAccountKey, listAccountKeys } from "./account-assets";
import { GET, POST } from "@/app/api/credentials/route";
import { DELETE } from "@/app/api/credentials/[id]/route";
import { POST as verify } from "@/app/api/credentials/[id]/verify/route";
import { NextRequest } from "next/server";
import { POST as addDocument } from "@/app/api/kb/route";
import { DELETE as deleteDocument } from "@/app/api/kb/[id]/route";
import { listKbDocuments } from "./runtime/kb";
import { serviceApiKey } from "./service-keys";

vi.mock("./audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

const current = vi.hoisted(() => ({ accountId: "account-a", signedIn: true }));
vi.mock("@/lib/account-assets", async (original) => {
  const actual = await original<typeof import("./account-assets")>();
  return { ...actual, requireAssetAccount: async () => {
    if (!current.signedIn) throw new actual.AssetError("Sign in.", 401);
    return { workspaceId: "ws_astronom", accountId: current.accountId };
  } };
});

const a = { workspaceId: "ws_astronom", accountId: "account-a" };
const b = { workspaceId: "ws_astronom", accountId: "account-b" };
const KEY = "test-muse-secret-never-return-this-value";
const request = (body: object) => new Request("http://localhost/api/credentials", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
  await seedPlatform();
  current.accountId = a.accountId; current.signedIn = true;
});

describe("account keys", () => {
  it.each(["composio", "serpapi"] as const)("keeps %s keys private, unique per account, and replaceable", async (purpose) => {
    const first = await POST(request({ purpose, key: KEY }));
    expect(first.status).toBe(201);
    const { id } = await first.json();
    await addAccountKey(b, purpose, KEY + "-b");
    expect(await serviceApiKey(purpose, a.accountId)).toBe(KEY);
    expect(await serviceApiKey(purpose, b.accountId)).toBe(KEY + "-b");
    expect((await POST(request({ purpose, key: KEY + "-duplicate" }))).status).toBe(409);
    expect(JSON.stringify(await (await GET()).json())).not.toContain(KEY);
    expect(await deleteAccountKey(b, id)).toBe(false);
    expect(await deleteAccountKey(a, id)).toBe(true);
    await addAccountKey(a, purpose, KEY + "-new");
    expect(await serviceApiKey(purpose, a.accountId)).toBe(KEY + "-new");
  });
  it("stores one Gemini key alongside Muse and isolates it by account", async () => {
    await addAccountKey(a, "muse", KEY);
    const response = await POST(request({ purpose: "gemini", key: KEY + "-gemini" }));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(await accountGeminiKey(a.accountId)).toBe(KEY + "-gemini");
    expect(await accountGeminiKey(b.accountId)).toBeNull();
    expect(await listAccountKeys(a)).toHaveLength(2);
    const attempts = await Promise.all([POST(request({ purpose: "gemini", key: KEY })), POST(request({ purpose: "gemini", key: KEY }))]);
    expect(attempts.map((result) => result.status)).toEqual([409, 409]);
    expect(JSON.stringify(await (await GET()).json())).not.toContain(KEY);
    expect(await deleteAccountKey(b, id)).toBe(false);
    expect(await deleteAccountKey(a, id)).toBe(true);
    expect(await accountMuseKey(a.accountId)).toBe(KEY);
    await addAccountKey(a, "gemini", KEY + "-replacement");
    expect(await accountGeminiKey(a.accountId)).toBe(KEY + "-replacement");
  });
  it("encrypts keys and never returns values, hints, or ciphertext through the API", async () => {
    const saved = await POST(request({ purpose: "muse", key: KEY }));
    expect(saved.status).toBe(201);
    const metadata = await saved.json();
    expect(Object.keys(metadata)).toEqual(["id"]);
    const [row] = await (await getDb()).select().from(credentials).where(eq(credentials.id, metadata.id));
    expect(row!.ciphertext).not.toContain(KEY);
    expect(row!.hint).toBe("Hidden");
    expect(await accountMuseKey(a.accountId)).toBe(KEY);
    const list = await GET();
    expect(await list.json()).toEqual({ keys: [{ id: metadata.id, name: "Muse", purpose: "muse" }] });
    const checked = await verify(new Request("http://localhost"), { params: Promise.resolve({ id: metadata.id }) });
    expect(await checked.json()).toEqual({ ok: true });
  });

  it("allows only one Muse key per account, including concurrent submissions", async () => {
    const attempts = await Promise.allSettled([addAccountKey(a, "muse", KEY), addAccountKey(a, "muse", KEY + "-replacement")]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AssetError);
    expect(rejected.reason.status).toBe(409);
    expect(await listAccountKeys(a)).toHaveLength(1);
    await addAccountKey(b, "muse", KEY + "-other-account");
    expect(await listAccountKeys(b)).toHaveLength(1);
  });

  it("rejects other purposes and submitted owner IDs", async () => {
    expect((await POST(request({ purpose: "openai", key: KEY }))).status).toBe(400);
    expect((await POST(request({ purpose: "muse", key: KEY, accountId: b.accountId }))).status).toBe(400);
    expect(await listAccountKeys(a)).toEqual([]);
  });

  it("blocks cross-account reads, checks, and deletion even with a known key ID", async () => {
    const { id } = await addAccountKey(a, "muse", KEY);
    current.accountId = b.accountId;
    expect(await (await GET()).json()).toEqual({ keys: [] });
    expect(await accountMuseKey(b.accountId)).toBeNull();
    expect((await verify(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect((await DELETE(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect(await accountMuseKey(a.accountId)).toBe(KEY);
  });

  it("requires a signed-in account and supports deleting then replacing a key", async () => {
    current.signedIn = false;
    expect((await POST(request({ purpose: "muse", key: KEY }))).status).toBe(401);
    expect((await GET()).status).toBe(401);
    const { id } = await addAccountKey(a, "muse", KEY);
    expect(await deleteAccountKey(b, id)).toBe(false);
    expect(await deleteAccountKey(a, id)).toBe(true);
    expect(await accountMuseKey(a.accountId)).toBeNull();
    await addAccountKey(a, "muse", KEY + "-new");
    expect(await accountMuseKey(a.accountId)).toBe(KEY + "-new");
  });

  it("assigns documents to the signed-in account and blocks foreign deletion", async () => {
    const response = await addDocument(new NextRequest("http://localhost/api/kb", { method: "POST", body: JSON.stringify({ title: "☄", body: "Account-private launch notes" }) }));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect((await listKbDocuments(a.workspaceId, a.accountId)).map((row) => row.id)).toEqual([id]);
    expect(await listKbDocuments(b.workspaceId, b.accountId)).toEqual([]);
    current.accountId = b.accountId;
    expect((await deleteDocument(new NextRequest("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(404);
    current.accountId = a.accountId;
    expect((await deleteDocument(new NextRequest("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(200);
  });

  it("rejects unsigned document writes and submitted ownership fields", async () => {
    const docRequest = (extra = {}) => new NextRequest("http://localhost/api/kb", { method: "POST", body: JSON.stringify({ title: "Notes", body: "Private text", ...extra }) });
    current.signedIn = false;
    expect((await addDocument(docRequest())).status).toBe(401);
    current.signedIn = true;
    expect((await addDocument(docRequest({ addedBy: b.accountId }))).status).toBe(400);
  });
});
