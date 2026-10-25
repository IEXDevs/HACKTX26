import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { getWorkspaceContext } from "@/lib/queries";
import { Sidebar } from "@/components/shell/sidebar";
import "./globals.css";
import "@/styles/relay.css";
import "@/styles/composer.css";

const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const display = Inter_Tight({ variable: "--font-display-face", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Astronom",
  description: "Build agents, watch them work, and approve what matters.",
};

export const dynamic = "force-dynamic";

// Applies the saved theme before first paint so the page never flashes the wrong one.
const themeScript = `try{if(localStorage.getItem("relay-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await ensureBootstrapped();
  const { workspace, user, spendTodayUsd, pendingApprovals } = await getWorkspaceContext();

  return (
    <html
      lang="en"
      className={`${ui.variable} ${display.variable} ${code.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="backdrop" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <Sidebar
          workspaceName={workspace.name}
          userName={user?.name ?? "Unassigned"}
          userRole={user?.role ?? "engineer"}
          spendTodayUsd={spendTodayUsd}
          dailyBudgetUsd={40}
          pendingApprovals={pendingApprovals}
        />
        <main className="shell-main">{children}</main>
      </body>
    </html>
  );
}
