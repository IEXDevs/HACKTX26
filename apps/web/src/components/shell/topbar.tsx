"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Link2,
  ListTree,
  Search,
  ShieldHalf,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { TriggerMenu, type TriggerPreset } from "./trigger-menu";

interface PaletteEntry {
  href: string;
  label: string;
  hint: string;
  group: string;
}

const STATIC_ENTRIES: PaletteEntry[] = [
  { href: "/", label: "Overview", hint: "workspace pulse", group: "Navigate" },
  { href: "/graph", label: "Agent graph", hint: "topology + per-agent views", group: "Navigate" },
  { href: "/runs", label: "Runs", hint: "execution history", group: "Navigate" },
  { href: "/security", label: "Security", hint: "findings + approvals", group: "Navigate" },
  { href: "/evals", label: "Evaluations", hint: "accuracy + intervention rate", group: "Navigate" },
  { href: "/build", label: "Builder", hint: "templates and agents", group: "Navigate" },
  { href: "/connectors", label: "Connectors", hint: "MCP, CLI, API, RAG, vault", group: "Navigate" },
  { href: "/policy", label: "Policy & audit", hint: "guardrails, budgets, audit trail", group: "Navigate" },
];

const GROUP_ICONS: Record<string, typeof LayoutDashboard> = {
  Navigate: LayoutDashboard,
  Agents: Terminal,
};

const PAGE_TITLES: Array<[string, string]> = [
  ["/graph", "Agent graph"],
  ["/runs", "Runs"],
  ["/security", "Security"],
  ["/evals", "Evaluations"],
  ["/build", "Builder"],
  ["/connectors", "Connectors"],
  ["/policy", "Policy & audit"],
];

export function TopBar({
  agents,
  pendingApprovals,
  dataClass,
  triggers = [],
  frozen = true,
}: {
  agents: Array<{ id: string; name: string; role: string }>;
  pendingApprovals: number;
  dataClass: string;
  triggers?: TriggerPreset[];
  frozen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...STATIC_ENTRIES,
      ...agents.map((agent) => ({
        href: `/agents/${agent.id}`,
        label: agent.name,
        hint: `${agent.role} · open console`,
        group: "Agents",
      })),
      ...agents.map((agent) => ({
        href: `/agents/${agent.id}/console`,
        label: `${agent.name} — console`,
        hint: "filesystem + prompt surface",
        group: "Agents",
      })),
    ],
    [agents],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 9);
    return entries
      .filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.hint.toLowerCase().includes(q) ||
          e.group.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [entries, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry) return;
      setOpen(false);
      router.push(entry.href);
    },
    [router],
  );

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[cursor]);
    }
  };

  const pageTitle =
    pathname === "/"
      ? "Overview"
      : (PAGE_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ??
        (pathname.startsWith("/agents") ? "Agent" : "Workspace"));

  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="md:hidden">
            <LayoutDashboard size={15} className="text-accent" />
          </Link>
          <span className="hidden text-[11px] text-ink-4 sm:inline">Astronom</span>
          <span className="hidden text-ink-4 sm:inline">/</span>
          <span className="truncate text-[12px] font-medium text-ink">{pageTitle}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {triggers.length > 0 ? <TriggerMenu presets={triggers} /> : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring group flex h-7 w-full max-w-[280px] items-center gap-2 rounded-xs border border-line bg-surface px-2 text-left text-[11px] text-ink-4 transition-colors hover:border-line-strong hover:text-ink-3"
          >
            <Search size={12} />
            <span className="flex-1 truncate">Search agents, runs, capabilities…</span>
            <span className="kbd hidden sm:inline-flex">⌘K</span>
          </button>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <span className="chip border-line bg-surface-2 normal-case tracking-normal">
            <span className="text-ink-4">data</span>
            <span className="text-ink-2">{dataClass}</span>
          </span>
          {frozen ? (
            <span className="chip border-warn/25 bg-warn/10 normal-case tracking-normal text-warn">
              prod freeze
            </span>
          ) : null}
        </div>

        <Link
          href="/security"
          className="focus-ring relative flex size-7 items-center justify-center rounded-xs border border-line bg-surface text-ink-3 hover:text-ink"
          title={`${pendingApprovals} pending approvals`}
        >
          <BellRing size={13} />
          {pendingApprovals > 0 ? (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-warn font-mono text-[8px] text-accent-ink">
              {pendingApprovals}
            </span>
          ) : null}
        </Link>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-void/70 px-4 pt-[12vh] backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="animate-fade-up relative w-full max-w-lg overflow-hidden rounded-md border border-line-strong bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={14} className="text-ink-4" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onInputKey}
                placeholder="Jump to an agent, run, or capability"
                className="h-11 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
              />
              <span className="kbd">esc</span>
            </div>
            <ul className="max-h-[46vh] overflow-y-auto py-1">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-[12px] text-ink-4">
                  Nothing matches “{query}”.
                </li>
              ) : null}
              {results.map((entry, index) => {
                const Icon = GROUP_ICONS[entry.group] ?? LayoutDashboard;
                return (
                  <li key={`${entry.href}-${index}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(entry)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                        index === cursor ? "bg-surface-2" : "hover:bg-surface-2/60",
                      )}
                    >
                      <Icon
                        size={13}
                        className={index === cursor ? "text-accent" : "text-ink-4"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-ink">{entry.label}</span>
                        <span className="block truncate text-[10px] text-ink-4">{entry.hint}</span>
                      </span>
                      <span className="micro shrink-0">{entry.group}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
