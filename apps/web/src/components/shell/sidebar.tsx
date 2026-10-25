"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Link2,
  ListTree,
  ShieldHalf,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import { Meter } from "@/components/ui/primitives";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  badge?: number;
  /** Match children too, e.g. /runs/abc highlights Runs. */
  exact?: boolean;
}

export function Sidebar({
  workspaceName,
  workspaceSlug,
  userName,
  userRole,
  spendTodayUsd,
  dailyBudgetUsd = 40,
  pendingApprovals,
  agentCount,
}: {
  workspaceName: string;
  workspaceSlug: string;
  userName: string;
  userRole: string;
  spendTodayUsd: number;
  dailyBudgetUsd?: number;
  pendingApprovals: number;
  agentCount: number;
}) {
  const pathname = usePathname();

  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "Operate",
      items: [
        { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
        { href: "/graph", label: "Agent graph", icon: GitBranch, badge: agentCount },
        { href: "/runs", label: "Runs", icon: ListTree },
      ],
    },
    {
      label: "Assure",
      items: [
        { href: "/security", label: "Security", icon: ShieldHalf },
        { href: "/evals", label: "Evaluations", icon: FlaskConical },
      ],
    },
    {
      label: "Build",
      items: [
        { href: "/build", label: "Builder", icon: Sparkles },
        { href: "/connectors", label: "Connectors", icon: Link2 },
        { href: "/policy", label: "Policy & audit", icon: Wallet },
      ],
    },
  ];

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const utilization = spendTodayUsd / Math.max(dailyBudgetUsd, 0.01);

  return (
    <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-line bg-void md:flex">
      {/* Workspace switcher */}
      <div className="border-b border-line px-3 py-3">
        <Link
          href="/"
          className="focus-ring group flex items-center gap-2.5 rounded-sm px-1 py-1"
        >
          <span className="flex size-7 items-center justify-center rounded-sm border border-line-strong bg-surface-2">
            <Boxes size={14} className="text-accent" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium leading-tight text-ink">
              {workspaceName}
            </span>
            <span className="mono block truncate text-[10px] text-ink-4">
              {workspaceSlug}
            </span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="micro px-2 pb-1.5">{group.label}</div>
            <ul className="space-y-px">
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-ring group relative flex items-center gap-2.5 rounded-xs px-2 py-[7px] text-[12px] transition-colors",
                        active
                          ? "bg-surface-2 text-ink"
                          : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
                      )}
                    >
                      {active ? (
                        <span className="absolute inset-y-1 left-0 w-px bg-accent" />
                      ) : null}
                      <Icon
                        size={14}
                        className={cn(
                          "shrink-0",
                          active ? "text-accent" : "text-ink-3 group-hover:text-ink-2",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="mono text-[10px] text-ink-4">{item.badge}</span>
                      ) : null}
                      {item.href === "/security" && pendingApprovals > 0 ? (
                        <span className="mono flex size-4 items-center justify-center rounded-full bg-warn/15 text-[9px] text-warn">
                          {pendingApprovals}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Budget footer — always visible, because cost is a first-class concern. */}
      <div className="border-t border-line px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="micro">Today</span>
          <span className="mono text-[11px] text-ink-2">
            {usd(spendTodayUsd)} <span className="text-ink-4">/ {usd(dailyBudgetUsd)}</span>
          </span>
        </div>
        <Meter
          value={utilization}
          tone={utilization > 0.9 ? "danger" : utilization > 0.7 ? "warn" : "accent"}
          className="mt-2"
          label="Daily spend against budget"
        />
        <div className="mt-3 flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface-2 font-mono text-[9px] text-ink-2"
            title={userName}
          >
            {userName
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join("")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] text-ink-2">{userName}</span>
            <span className="block truncate text-[10px] text-ink-4">{userRole}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
