import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Database,
  Globe,
  KeyRound,
  Link2,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { CredentialVault, type CredentialView } from "@/components/connectors/credential-vault";
import {
  DataTable,
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  RiskTag,
  StatusBadge,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import { TOOL_MANIFEST } from "@agent-os/core";
import { getWorkspaceContext, listConnectors } from "@/lib/queries";
import { KB_DOCUMENTS, searchKnowledgeBase } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

const KIND_META = {
  mcp: {
    label: "MCP servers",
    blurb: "Tools exposed by an external Model Context Protocol server.",
    icon: Plug,
  },
  api: {
    label: "HTTP APIs",
    blurb: "First-class provider integrations called through a typed adapter.",
    icon: Globe,
  },
  cli: {
    label: "CLIs",
    blurb: "Allowlisted binaries. Subcommands are restricted by policy.",
    icon: Terminal,
  },
  rag: {
    label: "Retrieval",
    blurb: "Chunked documents with provenance. Retrieved text is always untrusted.",
    icon: Database,
  },
  web: {
    label: "Web",
    blurb: "External search, gated by data classification.",
    icon: Search,
  },
} as const;

function renderConfigValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const ctx = await getWorkspaceContext();
  const { connectors, credentials } = await listConnectors(ctx.workspace.id);

  const query = q?.trim() ?? "";
  const hits = query.length > 1 ? searchKnowledgeBase(query, 5) : [];
  const connectorNames = Object.fromEntries(connectors.map((c) => [c.id, c.name]));

  const credentialViews: CredentialView[] = credentials.map((credential) => ({
    id: credential.id,
    name: credential.name,
    connectorName: credential.connectorId
      ? (connectorNames[credential.connectorId] ?? null)
      : null,
    hint: credential.hint,
    scopes: credential.scopes,
    createdBy: credential.createdBy,
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    rotatedAt: credential.rotatedAt?.toISOString() ?? null,
  }));

  const kinds = (Object.keys(KIND_META) as Array<keyof typeof KIND_META>).filter((kind) =>
    connectors.some((connector) => connector.kind === kind),
  );

  const connected = connectors.filter((connector) => connector.status === "connected").length;
  const degraded = connectors.filter((connector) => connector.status === "degraded").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Build · integrations"
        title="Connectors and the credential vault"
        description="MCP servers, typed APIs, allowlisted CLIs, retrieval, and web search — all reachable only through the tool manifest. Credentials are workspace-wide and encrypted at rest; agents never see plaintext."
        actions={
          <span className="mono flex items-center gap-1.5 text-[10px] text-ink-4">
            <Link2 size={11} /> {connectors.length} connectors
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          {
            label: "Connected",
            value: String(connected),
            sub: `${degraded} degraded · ${connectors.length - connected - degraded} offline`,
            icon: Plug,
          },
          {
            label: "Credentials",
            value: String(credentials.length),
            sub: "AES-256-GCM at rest · workspace-wide",
            icon: KeyRound,
          },
          {
            label: "Indexed documents",
            value: String(KB_DOCUMENTS.length),
            sub: `${new Set(KB_DOCUMENTS.map((document) => document.dataClass)).size} data classes`,
            icon: BookOpen,
          },
          {
            label: "Tools in manifest",
            value: String(TOOL_MANIFEST.length),
            sub: `${TOOL_MANIFEST.filter((tool) => tool.risk === "high" || tool.risk === "critical").length} high or critical`,
            icon: ShieldAlert,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-surface p-4">
              <div className="flex items-start justify-between">
                <Metric label={item.label} value={item.value} sub={item.sub} />
                <Icon size={14} className="mt-0.5 text-ink-4" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {kinds.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Plug size={20} />}
                title="No connectors"
                description="Nothing external is reachable from this workspace."
              />
            </Panel>
          ) : (
            kinds.map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              const rows = connectors.filter((connector) => connector.kind === kind);
              return (
                <Panel key={kind}>
                  <PanelHeader
                    title={meta.label}
                    hint={meta.blurb}
                    actions={<Icon size={13} className="text-ink-4" />}
                  />
                  <ul className="divide-y divide-line">
                    {rows.map((connector) => (
                      <li key={connector.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[12px] text-ink">{connector.name}</span>
                              <Tag tone="muted">{connector.provider}</Tag>
                              <StatusBadge status={connector.status} />
                            </div>
                            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
                              {connector.description}
                            </p>
                          </div>
                          <span className="mono shrink-0 text-[9px] text-ink-4">
                            synced {relativeTime(connector.lastSyncAt)}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                          {Object.entries(connector.config).map(([key, value]) => (
                            <div
                              key={key}
                              className="mono flex items-baseline justify-between gap-3 text-[9.5px]"
                            >
                              <span className="text-ink-4">{key}</span>
                              <span className="truncate text-right text-ink-2">
                                {renderConfigValue(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {connector.status === "degraded" ? (
                          <p className="mt-2 rounded-xs border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] leading-relaxed text-warn">
                            Degraded: the credential lacks one of the declared scopes. Calls
                            that need it will fail closed, not fall back.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })
          )}
        </div>

        <div className="space-y-6">
          <Panel className="self-start">
            <PanelHeader
              title="Credential vault"
              hint="One workspace, one set of secrets"
              actions={<KeyRound size={13} className="text-ink-4" />}
            />
            {credentials.length === 0 ? (
              <EmptyState
                icon={<KeyRound size={18} />}
                title="No credentials"
                description="Connectors can still be read-only public, but anything authenticated needs a stored secret."
              />
            ) : (
              <CredentialVault credentials={credentialViews} />
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Retrieval index"
              hint="Lexical search over real fixtures — no hidden embeddings"
              actions={<BookOpen size={13} className="text-ink-4" />}
            />
            <form action="/connectors" method="get" className="flex gap-2 border-b border-line px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={11}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
                />
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search runbooks, ADRs, legal…"
                  className="focus-ring h-7 w-full rounded-xs border border-line-strong bg-surface-2 pl-6 pr-2 text-[11px] text-ink placeholder:text-ink-4"
                />
              </div>
              <button
                type="submit"
                className="focus-ring mono rounded-xs border border-line-strong px-2 text-[10px] text-ink-2 hover:border-accent/50 hover:text-accent"
              >
                search
              </button>
            </form>

            {query.length > 1 ? (
              <div className="border-b border-line">
                <div className="micro px-4 pt-2.5 pb-1">
                  {hits.length} hit{hits.length === 1 ? "" : "s"} for “{query}”
                </div>
                {hits.length === 0 ? (
                  <p className="px-4 pb-3 text-[10.5px] text-ink-4">
                    No document scored above the relevance floor. The agent would get an
                    empty result and must say so.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {hits.map((hit) => (
                      <li key={hit.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] text-ink">{hit.title}</span>
                          <span className="mono shrink-0 text-[9px] text-accent">
                            {hit.score.toFixed(3)}
                          </span>
                        </div>
                        <div className="mono mt-0.5 flex items-center gap-1.5 text-[9px] text-ink-4">
                          <span>{hit.path}</span>
                          <Tag tone="muted">{hit.dataClass}</Tag>
                          <Tag tone="warn">{hit.trust}</Tag>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-3">
                          {hit.snippet}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="px-4 py-2 text-[9.5px] leading-relaxed text-ink-4">
                  Retrieval is labeled untrusted at the message boundary. One fixture
                  deliberately contains an injected directive so the red team can find it.
                </p>
              </div>
            ) : null}

            <ul className="divide-y divide-line">
              {KB_DOCUMENTS.map((document) => (
                <li key={document.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-ink-2">{document.title}</span>
                    <Tag
                      tone={
                        document.dataClass === "confidential"
                          ? "warn"
                          : document.dataClass === "restricted"
                            ? "danger"
                            : "muted"
                      }
                    >
                      {document.dataClass}
                    </Tag>
                  </div>
                  <div className="mono mt-0.5 flex items-center justify-between text-[9px] text-ink-4">
                    <span>{document.path}</span>
                    <span>{document.body.length} chars</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Tool manifest"
          hint="The single declaration the runtime, policy engine, and UI all read"
          actions={
            <Link
              href="/policy#rules"
              className="focus-ring micro flex items-center gap-1 text-accent hover:text-accent/80"
            >
              policy matrix <ArrowUpRight size={10} />
            </Link>
          }
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Tool</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th align="right" className="hidden sm:table-cell">Scopes</Th>
              <Th align="right">Risk</Th>
              <Th align="right" className="hidden lg:table-cell">Sandboxed</Th>
            </tr>
          </thead>
          <tbody>
            {TOOL_MANIFEST.map((tool) => (
              <Tr key={tool.name}>
                <Td>
                  <div className="mono text-[11px] text-ink">{tool.name}</div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-ink-4">
                    {tool.description}
                  </div>
                </Td>
                <Td className="mono hidden text-[10px] text-ink-3 md:table-cell">
                  {tool.category}
                </Td>
                <Td align="right" className="mono hidden text-[10px] text-ink-3 sm:table-cell">
                  {tool.scopes.join(" · ")}
                </Td>
                <Td align="right">
                  <RiskTag risk={tool.risk} />
                </Td>
                <Td align="right" className="mono hidden text-[9.5px] lg:table-cell">
                  {tool.sandboxedToAgentFs ? (
                    <span className="text-ok">agent root</span>
                  ) : (
                    <span className="text-ink-4">unbounded</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
