/**
 * Composio client for per-user app connectors.
 *
 * Catalog, OAuth link, connected-account sync, and action execution all go
 * through here so the rest of the runtime never talks to Composio directly.
 * Saved account keys override the platform key. Without either key, the
 * popular catalog still renders and connect returns a clear error.
 */
import { Composio } from "@composio/core";
import { serviceApiKey } from "./service-keys";

export const SERPAPI_TOOLKIT = "serpapi";

export interface ToolkitInfo {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string | null;
  popular: boolean;
  builtin?: boolean;
}

export interface ConnectedToolkit {
  toolkit: string;
  toolkitName: string;
  accountId: string | null;
  status: "connected" | "pending" | "disconnected" | "error";
  authConfigId: string | null;
}

export interface ToolkitAction {
  slug: string;
  name: string;
  description: string;
}

export const POPULAR_TOOLKITS: ToolkitInfo[] = [
  { slug: "github", name: "GitHub", description: "Link a repo so agents can see the tree and edit files.", logoUrl: null, category: "developer", popular: true },
  { slug: "gmail", name: "Gmail", description: "Read and send mail from the linked inbox.", logoUrl: null, category: "communication", popular: true },
  { slug: "slack", name: "Slack", description: "Channels, DMs, and workspace search.", logoUrl: null, category: "communication", popular: true },
  { slug: "googlecalendar", name: "Google Calendar", description: "Events, availability, and invites.", logoUrl: null, category: "productivity", popular: true },
  { slug: "googledrive", name: "Google Drive", description: "Files, folders, and sharing.", logoUrl: null, category: "productivity", popular: true },
  { slug: "notion", name: "Notion", description: "Pages, databases, and comments.", logoUrl: null, category: "productivity", popular: true },
  { slug: "linear", name: "Linear", description: "Issues, projects, and status updates.", logoUrl: null, category: "developer", popular: true },
  { slug: "jira", name: "Jira", description: "Tickets, sprints, and project search.", logoUrl: null, category: "developer", popular: true },
  { slug: "outlook", name: "Outlook", description: "Mail and calendar on Microsoft 365.", logoUrl: null, category: "communication", popular: true },
  { slug: "discord", name: "Discord", description: "Servers, channels, and messages.", logoUrl: null, category: "communication", popular: true },
  { slug: "googlesheets", name: "Google Sheets", description: "Read and update spreadsheets.", logoUrl: null, category: "productivity", popular: true },
  { slug: "googledocs", name: "Google Docs", description: "Read and draft documents.", logoUrl: null, category: "productivity", popular: true },
  { slug: "hubspot", name: "HubSpot", description: "CRM contacts, deals, and notes.", logoUrl: null, category: "crm", popular: true },
  { slug: "asana", name: "Asana", description: "Tasks, projects, and assignments.", logoUrl: null, category: "productivity", popular: true },
  { slug: "trello", name: "Trello", description: "Boards, lists, and cards.", logoUrl: null, category: "productivity", popular: true },
  { slug: "salesforce", name: "Salesforce", description: "Accounts, opportunities, and cases.", logoUrl: null, category: "crm", popular: true },
  { slug: "zendesk", name: "Zendesk", description: "Tickets and customer replies.", logoUrl: null, category: "support", popular: true },
  { slug: "dropbox", name: "Dropbox", description: "Files and shared folders.", logoUrl: null, category: "productivity", popular: true },
  { slug: "zoom", name: "Zoom", description: "Meetings and recordings.", logoUrl: null, category: "communication", popular: true },
  { slug: "airtable", name: "Airtable", description: "Bases, tables, and records.", logoUrl: null, category: "productivity", popular: true },
  { slug: "clickup", name: "ClickUp", description: "Tasks, docs, and sprints.", logoUrl: null, category: "productivity", popular: true },
  { slug: "figma", name: "Figma", description: "Files, comments, and components.", logoUrl: null, category: "design", popular: true },
  { slug: "stripe", name: "Stripe", description: "Customers, invoices, and payments.", logoUrl: null, category: "finance", popular: true },
  { slug: "datadog", name: "Datadog", description: "Metrics, monitors, and log search.", logoUrl: null, category: "ops", popular: true },
  { slug: "confluence", name: "Confluence", description: "Spaces and wiki pages.", logoUrl: null, category: "productivity", popular: true },
];

export const SERPAPI_TOOLKIT_INFO: ToolkitInfo = {
  slug: SERPAPI_TOOLKIT,
  name: "Web search",
  description: "Search the public web with SerpAPI.",
  logoUrl: null,
  category: "search",
  popular: true,
  builtin: true,
};

const POPULAR_BY_SLUG = new Map(POPULAR_TOOLKITS.map((item) => [item.slug, item]));

async function getClient(userId?: string): Promise<Composio | null> {
  const apiKey = await serviceApiKey("composio", userId);
  if (!apiKey) return null;
  try { return new Composio({ apiKey }); }
  catch { console.warn("[composio] failed to initialize client"); return null; }
}

export async function requireComposio(userId: string): Promise<Composio> {
  const instance = await getClient(userId);
  if (!instance) throw new Error("Add a Composio key under Saved keys to link apps.");
  return instance;
}

export function normalizeToolkit(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "");
}

export function parseConnectorList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const slug = normalizeToolkit(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "data", "toolkits", "connectedAccounts"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function str(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toolkitFromUnknown(value: unknown, popular = false): ToolkitInfo | null {
  const record = asRecord(value);
  if (!record) return null;
  const slug = normalizeToolkit(str(record, "slug", "key", "name") ?? "");
  if (!slug) return null;
  const meta = asRecord(record.meta) ?? asRecord(record.metadata) ?? {};
  const known = POPULAR_BY_SLUG.get(slug);
  return {
    slug,
    name: str(record, "name", "displayName") ?? known?.name ?? slug,
    description:
      str(record, "description") ??
      str(meta, "description") ??
      known?.description ??
      "",
    logoUrl: str(record, "logo", "logoUrl", "icon") ?? str(meta, "logo", "logoUrl") ?? known?.logoUrl ?? null,
    category:
      str(record, "category") ??
      (Array.isArray(record.categories) && typeof record.categories[0] === "string"
        ? record.categories[0]
        : null) ??
      known?.category ??
      null,
    popular: popular || Boolean(known),
  };
}

export function resolveActionSlug(toolkit: string, action: string): string {
  const raw = action.trim();
  if (!raw) return "";
  if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(raw)) return raw;
  const prefix = normalizeToolkit(toolkit).replace(/-/g, "_").toUpperCase();
  const upper = raw.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase().replace(/^_+|_+$/g, "");
  if (upper.startsWith(`${prefix}_`)) return upper;
  return `${prefix}_${upper}`;
}

export async function searchToolkits(query = "", userId?: string): Promise<ToolkitInfo[]> {
  const needle = query.trim().toLowerCase();
  const local = [SERPAPI_TOOLKIT_INFO, ...POPULAR_TOOLKITS].filter((item) => {
    if (!needle) return item.popular;
    return (
      item.slug.includes(needle) ||
      item.name.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      (item.category ?? "").includes(needle)
    );
  });

  const composio = await getClient(userId);
  if (!composio || !needle) return dedupeToolkits(local);

  try {
    const raw = await composio.toolkits.get({
      limit: 40,
      search: needle,
    } as never);
    const remote = itemsOf(raw)
      .map((item) => toolkitFromUnknown(item))
      .filter((item): item is ToolkitInfo => Boolean(item));
    return dedupeToolkits([...remote, ...local]);
  } catch {
    console.warn("[composio] toolkit search failed:");
    return dedupeToolkits(local);
  }
}

function dedupeToolkits(list: ToolkitInfo[]): ToolkitInfo[] {
  const seen = new Set<string>();
  const out: ToolkitInfo[] = [];
  for (const item of list) {
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    out.push(item);
  }
  return out;
}

const CONNECTED_STATUS_RANK: Record<ConnectedToolkit["status"], number> = {
  connected: 3,
  pending: 2,
  error: 1,
  disconnected: 0,
};

/** One row per toolkit. An ACTIVE GitHub account wins over leftover EXPIRED attempts. */
export function preferConnectedAccounts(rows: ConnectedToolkit[]): ConnectedToolkit[] {
  const byToolkit = new Map<string, ConnectedToolkit>();
  for (const row of rows) {
    const previous = byToolkit.get(row.toolkit);
    if (!previous || CONNECTED_STATUS_RANK[row.status] > CONNECTED_STATUS_RANK[previous.status]) {
      byToolkit.set(row.toolkit, row);
    }
  }
  return [...byToolkit.values()];
}

export async function listConnectedFromComposio(
  userId: string,
): Promise<ConnectedToolkit[] | undefined> {
  const composio = await getClient(userId);
  if (!composio) return undefined;
  try {
    const raw = await composio.connectedAccounts.list({ userIds: [userId] });
    return preferConnectedAccounts(itemsOf(raw).flatMap((item) => {
      const record = asRecord(item);
      if (!record) return [];
      const toolkitRecord = asRecord(record.toolkit) ?? {};
      const toolkit =
        normalizeToolkit(
          str(record, "toolkitSlug", "toolkit") ??
            str(toolkitRecord, "slug", "name") ??
            "",
        );
      if (!toolkit) return [];
      const statusRaw = (str(record, "status") ?? "").toUpperCase();
      const status: ConnectedToolkit["status"] =
        statusRaw === "ACTIVE" || statusRaw === "CONNECTED"
          ? "connected"
          : statusRaw === "INITIATED" || statusRaw === "PENDING"
            ? "pending"
            : statusRaw === "FAILED" || statusRaw === "EXPIRED"
              ? "error"
              : "disconnected";
      return [
        {
          toolkit,
          toolkitName: str(toolkitRecord, "name") ?? POPULAR_BY_SLUG.get(toolkit)?.name ?? toolkit,
          accountId: str(record, "id", "nanoid", "connectedAccountId"),
          status,
          authConfigId: str(record, "authConfigId") ?? str(asRecord(record.authConfig) ?? {}, "id"),
        },
      ];
    }));
  } catch {
    console.warn("[composio] list connected failed:");
    return undefined;
  }
}

export async function startToolkitLink(
  userId: string,
  toolkit: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string }> {
  const slug = normalizeToolkit(toolkit);
  if (!slug || slug === SERPAPI_TOOLKIT) {
    throw new Error("That app cannot be linked through Composio.");
  }
  const composio = await requireComposio(userId);
  const request = await (async () => {
    try { const session = await composio.create(userId); return await session.authorize(slug, { callbackUrl }); }
    catch { throw new Error("Could not link this app. Check your Composio key and try again."); }
  })();
  const record = asRecord(request) ?? {};
  const redirectUrl =
    str(record, "redirectUrl", "redirect_url") ??
    (typeof (request as { redirectUrl?: string }).redirectUrl === "string"
      ? (request as { redirectUrl: string }).redirectUrl
      : null);
  if (!redirectUrl) {
    throw new Error("Composio did not return a connect URL for this app.");
  }
  return { redirectUrl };
}

export async function disconnectToolkit(userId: string, toolkit: string): Promise<void> {
  const slug = normalizeToolkit(toolkit);
  const accounts = await listConnectedFromComposio(userId);
  if (!accounts) return;
  const match = accounts.find((item) => item.toolkit === slug && item.accountId);
  if (!match?.accountId) return;
  const composio = await requireComposio(userId);
  const accountsApi = composio.connectedAccounts as unknown as {
    delete?: (id: string) => Promise<unknown>;
    disable?: (id: string) => Promise<unknown>;
  };
  if (typeof accountsApi.delete === "function") {
    await accountsApi.delete(match.accountId).catch(() => { throw new Error("Could not disconnect this app. Check your Composio key and try again."); });
    return;
  }
  if (typeof accountsApi.disable === "function") {
    await accountsApi.disable(match.accountId).catch(() => { throw new Error("Could not disconnect this app. Check your Composio key and try again."); });
  }
}

export async function listToolkitActions(userId: string, toolkit: string): Promise<ToolkitAction[]> {
  const slug = normalizeToolkit(toolkit);
  if (!slug || slug === SERPAPI_TOOLKIT) {
    return [
      {
        slug: "web.search",
        name: "Web search",
        description: "Search the public web. Pass { query }.",
      },
    ];
  }
  const composio = await getClient(userId);
  if (!composio) return [];
  try {
    const raw = await composio.tools.get(userId, { toolkits: [slug, slug.toUpperCase()], limit: 12 });
    return itemsOf(raw)
      .map((item) => {
        const record = asRecord(item);
        if (!record) return null;
        const functionRecord = asRecord(record.function) ?? asRecord(record.function_calling) ?? {};
        const actionSlug =
          str(record, "slug", "name", "toolSlug") ??
          str(functionRecord, "name") ??
          "";
        if (!actionSlug) return null;
        return {
          slug: actionSlug,
          name: str(record, "name", "displayName") ?? actionSlug,
          description: str(record, "description") ?? str(functionRecord, "description") ?? "",
        };
      })
      .filter((item): item is ToolkitAction => Boolean(item));
  } catch {
    console.warn("[composio] list actions failed:");
    return [];
  }
}

export async function executeComposioActionRaw(input: {
  userId: string;
  toolkit: string;
  action: string;
  arguments?: Record<string, unknown>;
  connectedAccountId?: string | null;
}): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const composio = await requireComposio(input.userId);
  const slug = resolveActionSlug(input.toolkit, input.action);
  if (!slug) return { ok: false, data: null, error: "connector.call needs an action name." };
  try {
    const result = await composio.tools.execute(slug, {
      userId: input.userId,
      arguments: input.arguments ?? {},
      ...(input.connectedAccountId ? { connectedAccountId: input.connectedAccountId } : {}),
      dangerouslySkipVersionCheck: true,
    });
    const record = asRecord(result) ?? {};
    const error =
      (typeof record.error === "string" && record.error) ||
      (record.successful === false ? "Composio action failed." : null);
    const data = record.data ?? record.result ?? result;
    if (error) return { ok: false, data, error };
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      data: null,
      error: "Composio action failed. Check the saved key and app connection.",
    };
  }
}

export async function executeComposioAction(input: {
  userId: string;
  toolkit: string;
  action: string;
  arguments?: Record<string, unknown>;
}): Promise<{ ok: boolean; preview: string; error?: string }> {
  const result = await executeComposioActionRaw(input);
  const preview =
    typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? {}, null, 2);
  if (!result.ok) return { ok: false, preview: preview.slice(0, 4_000), error: result.error };
  return { ok: true, preview: preview.slice(0, 4_000) };
}
