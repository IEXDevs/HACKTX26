"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CreditCard,
  GitBranch,
  House,
  Logo,
  Link2,
  ListTree,
  Lock,
  LogOut,
  Plus,
  ScrollText,
  Settings,
  ShieldHalf,
} from "@/components/icons";
import { type ComponentType } from "react";
import { usd } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  count?: number;
  exact?: boolean;
  /** Other routes that light up this item. */
  also?: string[];
  /** A shortcut revealed under the item on hover or focus. */
  shortcut?: { href: string; label: string };
}

export function Sidebar({
  workspaceName,
  userName,
  userRole,
  spendTodayUsd,
  dailyBudgetUsd = 40,
  pendingApprovals,
  signedIn = true,
  canSignOut = false,
}: {
  workspaceName: string;
  userName: string;
  userRole: string;
  spendTodayUsd: number;
  dailyBudgetUsd?: number;
  pendingApprovals: number;
  signedIn?: boolean;
  canSignOut?: boolean;
}) {
  const pathname = usePathname();
  const main: NavItem[] = [
    { href: "/", label: "Home", icon: House, exact: true, count: pendingApprovals },
    { href: "/agents", label: "Agents", icon: Bot, shortcut: { href: "/agents/new", label: "New agent" } },
    { href: "/workflows", label: "Workflows", icon: GitBranch, also: ["/graph"] },
    { href: "/runs", label: "Runs", icon: ListTree },
    { href: "/usage", label: "Usage", icon: Activity },
    { href: "/billing", label: "Billing", icon: CreditCard },
  ];
  const platform: NavItem[] = [
    { href: "/security", label: "Security", icon: ShieldHalf },
    { href: "/observability", label: "Observability", icon: ScrollText },
    { href: "/connectors", label: "Connectors", icon: Link2 },
    { href: "/policy", label: "Privacy", icon: Lock },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const onShortcut = (item: NavItem) => item.shortcut !== undefined && pathname === item.shortcut.href;
  const isActive = (item: NavItem) =>
    !onShortcut(item) &&
    (item.exact
      ? pathname === item.href
      : [item.href, ...(item.also ?? [])].some(
          (href) => pathname === href || pathname.startsWith(`${href}/`),
        ));
  const used = Math.min(1, spendTodayUsd / Math.max(dailyBudgetUsd, 0.01));

  const renderLink = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={isActive(item) ? "active" : ""}
      aria-current={isActive(item) ? "page" : undefined}
      title={item.label}
    >
      <item.icon size={17} aria-hidden />
      <span>{item.label}</span>
      {item.count ? <span className="shell-count">{item.count}</span> : null}
    </Link>
  );

  const renderItem = (item: NavItem) => {
    if (!item.shortcut) return renderLink(item);
    const here = onShortcut(item);
    return (
      <div key={item.href} className={`shell-nav-group${here ? " open" : ""}`}>
        {renderLink(item)}
        <div className="shell-nav-reveal">
          <div>
            <Link
              href={item.shortcut.href}
              className={`shell-nav-shortcut${here ? " active" : ""}`}
              aria-current={here ? "page" : undefined}
              title={item.shortcut.label}
            >
              <Plus size={15} aria-hidden />
              <span>{item.shortcut.label}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="shell-sidebar">
      <Link href="/" className="shell-brand">
        <span className="shell-logo">
          <Logo size={20} />
        </span>
        <span>Astronom</span>
      </Link>
      <nav className="shell-nav" aria-label="Main navigation">
        {main.map(renderItem)}
      </nav>
      <nav className="shell-nav" aria-label="Platform">
        <div className="shell-nav-label">Platform</div>
        {platform.map(renderItem)}
      </nav>
      <div className="shell-bottom">
        <div className="shell-spend">
          {usd(spendTodayUsd)} of {usd(dailyBudgetUsd)} today
          <div className="shell-spend-track">
            <i style={{ width: `${used * 100}%` }} />
          </div>
        </div>
        <div className="shell-profile">
          <span aria-hidden>{userName.charAt(0)}</span>
          <div>
            <b>{userName}</b>
            <small>
              {workspaceName} · {userRole}
            </small>
          </div>
        </div>
        {canSignOut ? (
          <form action="/auth/signout" method="post">
            <button type="submit" className="shell-signout">
              <LogOut size={16} aria-hidden />
              <span>Sign out</span>
            </button>
          </form>
        ) : null}
        {!signedIn ? (
          <Link href="/login" className="shell-signout">
            Sign in
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
