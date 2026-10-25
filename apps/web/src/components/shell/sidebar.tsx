"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CreditCard,
  FlaskConical,
  GitBranch,
  House,
  Logo,
  Link2,
  ListTree,
  Moon,
  Scale,
  ShieldHalf,
  Sun,
} from "@/components/icons";
import { useEffect, useState, type ComponentType } from "react";
import { usd } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  count?: number;
  exact?: boolean;
}

export function Sidebar({
  workspaceName,
  userName,
  userRole,
  spendTodayUsd,
  dailyBudgetUsd = 40,
  pendingApprovals,
}: {
  workspaceName: string;
  userName: string;
  userRole: string;
  spendTodayUsd: number;
  dailyBudgetUsd?: number;
  pendingApprovals: number;
}) {
  const pathname = usePathname();
  const main: NavItem[] = [
    { href: "/", label: "Home", icon: House, exact: true, count: pendingApprovals },
    { href: "/agents", label: "Agents", icon: Bot },
    { href: "/runs", label: "Runs", icon: ListTree },
    { href: "/usage", label: "Usage", icon: Activity },
    { href: "/billing", label: "Billing", icon: CreditCard },
  ];
  const platform: NavItem[] = [
    { href: "/security", label: "Security", icon: ShieldHalf },
    { href: "/evals", label: "Evaluations", icon: FlaskConical },
    { href: "/connectors", label: "Connectors", icon: Link2 },
    { href: "/policy", label: "Policy", icon: Scale },
    { href: "/graph", label: "Agent graph", icon: GitBranch },
  ];
  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const used = Math.min(1, spendTodayUsd / Math.max(dailyBudgetUsd, 0.01));

  const renderItem = (item: NavItem) => (
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
        <ThemeSwitch />
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
      </div>
    </aside>
  );
}

/** Light or dark. Saved per viewer; the layout applies it before first paint. */
function ThemeSwitch() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("relay-theme", next ? "dark" : "light");
    } catch {}
  }
  return (
    <button type="button" onClick={toggle} title={dark ? "Light theme" : "Dark theme"}>
      {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      <span>{dark ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}
