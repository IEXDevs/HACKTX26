import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { getWorkspaceContext } from "@/lib/queries";
import { SiteBackdrop } from "@/components/shell/backdrop";
import { Sidebar } from "@/components/shell/sidebar";
import { PageLoading } from "@/components/shell/page-loading";
import { getSessionUser } from "@/lib/auth";
import { supabaseAuthEnabled } from "@/lib/env";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";
import "@/styles/relay.css";
import "@/styles/composer.css";
import "@/styles/navigation.css";
import "@/styles/builder-updates.css";

const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const display = Inter_Tight({ variable: "--font-display-face", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Astronom",
  description: "Build agents, watch them work, and approve what matters.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${display.variable} ${code.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets the theme before first paint so the page never flashes the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="backdrop" aria-hidden="true">
          <SiteBackdrop />
        </div>
        <Suspense fallback={<main className="shell-main"><PageLoading /></main>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}

/** Keep account/database reads inside Suspense so the document can stream at once. */
async function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const authShell = pathname === "/login" || pathname.startsWith("/auth/");
  if (!authShell) await ensureBootstrapped();
  const ctx = authShell ? null : await getWorkspaceContext();
  const session = authShell ? null : await getSessionUser();

  return ctx ? (
    <>
      <Sidebar
        workspaceName={ctx.workspace.name}
        userName={session?.name ?? ctx.user?.name ?? "Unassigned"}
        userRole={ctx.user?.role ?? "engineer"}
        spendTodayUsd={ctx.spendTodayUsd}
        dailyBudgetUsd={40}
        pendingApprovals={ctx.pendingApprovals}
        signedIn={Boolean(session) || !supabaseAuthEnabled()}
        canSignOut={Boolean(session)}
      />
      <main className="shell-main">{children}</main>
    </>
  ) : children;
}
