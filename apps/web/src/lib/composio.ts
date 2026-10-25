/**
 * Composio client for per-user app connectors.
 *
 * Catalog, OAuth link, connected-account sync, and action execution all go
 * through here so the rest of the runtime never talks to Composio directly.
 * Missing COMPOSIO_API_KEY is a soft failure: the popular catalog still
 * renders and connect returns a clear error.
 */
import { Composio } from "@composio/core";
import { composioEnabled, env } from "./env";

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
  { slug: "github", name: "GitHub", description: "Repos, issues, pull requests, and Actions.", logoUrl: null, category: "developer", popular: true },
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
  description: "Public Google search via SerpAPI. Platform-wide; no OAuth.",
  logoUrl: null,
  category: "search",
  popular: true,
  builtin: true,
};

const POPULAR_BY_SLUG = new Map(POPULAR_TOOLKITS.map((item) => [item.slug, item]));

let client: Composio | null | undefined;

function getClient(): Composio | null {
  if (!composioEnabled()) return null;
  if (client !== undefined) return client;
  try {
    client = new Composio({ apiKey: env.composio.apiKey });
  } catch (error) {
    console.warn("[composio] failed to init:", error instanceof Error ? error.message : error);
    client = null;
  }
  return client;
}

export function requireComposio(): Composio {
  const instance = getClient();
  if (!instance) {
    throw new Error("COMPOSIO_API_KEY is not set. Add it to .env.local, then restart.");
  }
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

export async function searchToolkits(query = ""): Promise<ToolkitInfo[]> {
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

  const composio = getClient();
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
  } catch (error) {
    console.warn("[composio] toolkit search failed:", error instanceof Error ? error.message : error);
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

export async function listConnectedFromComposio(
  userId: string,
): Promise<ConnectedToolkit[] | undefined> {
  const composio = getClient();
  if (!composio) return undefined;
  try {
    const raw = await composio.connectedAccounts.list({ userIds: [userId] });
    return itemsOf(raw).flatMap((item) => {
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
    });
  } catch (error) {
    console.warn("[composio] list connected failed:", error instanceof Error ? error.message : error);
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
  const composio = requireComposio();
  const session = await composio.create(userId);
  const request = await session.authorize(slug, { callbackUrl });
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
  const composio = requireComposio();
  const accountsApi = composio.connectedAccounts as unknown as {
    delete?: (id: string) => Promise<unknown>;
    disable?: (id: string) => Promise<unknown>;
  };
  if (typeof accountsApi.delete === "function") {
    await accountsApi.delete(match.accountId);
    return;
  }
  if (typeof accountsApi.disable === "function") {
    await accountsApi.disable(match.accountId);
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
  const composio = getClient();
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
  } catch (error) {
    console.warn("[composio] list actions failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function executeComposioAction(input: {
  userId: string;
  toolkit: string;
  action: string;
  arguments?: Record<string, unknown>;
}): Promise<{ ok: boolean; preview: string; error?: string }> {
  const composio = requireComposio();
  const slug = resolveActionSlug(input.toolkit, input.action);
  if (!slug) return { ok: false, preview: "", error: "connector.call needs an action name." };
  try {
    const result = await composio.tools.execute(slug, {
      userId: input.userId,
      arguments: input.arguments ?? {},
      dangerouslySkipVersionCheck: true,
    });
    const record = asRecord(result) ?? {};
    const error =
      (typeof record.error === "string" && record.error) ||
      (record.successful === false ? "Composio action failed." : null);
    const data = record.data ?? record.result ?? result;
    const preview =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    if (error) return { ok: false, preview: preview.slice(0, 4_000), error };
    return { ok: true, preview: preview.slice(0, 4_000) };
  } catch (error) {
    return {
      ok: false,
      preview: "",
      error: error instanceof Error ? error.message : "Composio action failed.",
    };
  }
}
