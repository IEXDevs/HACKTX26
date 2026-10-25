import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { getWorkspaceContext, listAgents, listTriggers } from "@/lib/queries";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent OS — Astronom",
  description:
    "Internal platform for building, routing, guarding and observing agent systems.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await ensureBootstrapped();

  const workspaceContext = await getWorkspaceContext();
  const [workspace, user, spendTodayUsd, pendingApprovals, agentCount] = [
    workspaceContext.workspace,
    workspaceContext.user,
    workspaceContext.spendTodayUsd,
    workspaceContext.pendingApprovals,
    workspaceContext.agentCount,
  ];
  const [agents, triggerRows] = await Promise.all([
    listAgents(workspace.id),
    listTriggers(workspace.id),
  ]);

  const presets: Array<{
    kind: "manual" | "webhook" | "schedule";
    preferredId: string;
    label: string;
    hint: string;
    goal: string;
  }> = [
    {
      kind: "webhook",
      preferredId: "trg_pagerduty",
      label: "Event webhook",
      hint: "PagerDuty · checkout latency",
      goal:
        "PagerDuty high-severity alert: checkout p95 latency jumped to 4.2s after the 14:05 deploy. Diagnose the regression and restore latency below 800ms.",
    },
    {
      kind: "schedule",
      preferredId: "trg_alert_digest",
      label: "Scheduled sweep",
      hint: "15-minute alert digest",
      goal:
        "Scheduled 15-minute triage: correlate the latest checkout telemetry with the deploy log and report any regression before it pages a human.",
    },
    {
      kind: "manual",
      preferredId: "trg_contract_manual",
      label: "Manual request",
      hint: "Acme MSA renewal review",
      goal:
        "Summarise the renewal, liability, and termination risks in the Acme vendor MSA and flag the clauses that need legal review.",
    },
  ];

  const triggerPresets = presets.flatMap((preset) => {
    const trigger =
      triggerRows.find((row) => row.id === preset.preferredId) ??
      triggerRows.find((row) => row.kind === preset.kind && row.enabled);
    if (!trigger) return [];
    const agent = agents.find((row) => row.id === trigger.agentId);
    if (!agent) return [];
    return [
      {
        triggerId: trigger.id,
        kind: preset.kind,
        label: preset.label,
        hint: preset.hint,
        agentId: agent.id,
        agentName: agent.name,
        goal: preset.goal,
        disabled: !trigger.enabled || agent.status !== "active",
      },
    ];
  });

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-bg antialiased">
        <div className="flex min-h-screen">
          <Sidebar
            workspaceName={workspace.name}
            workspaceSlug={workspace.slug}
            userName={user?.name ?? "Unassigned"}
            userRole={user?.role ?? "engineer"}
            spendTodayUsd={spendTodayUsd}
            dailyBudgetUsd={40}
            pendingApprovals={pendingApprovals}
            agentCount={agentCount}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              agents={agents.map((a) => ({ id: a.id, name: a.name, role: a.role }))}
              pendingApprovals={pendingApprovals}
              dataClass={workspace.defaultDataClass}
              triggers={triggerPresets}
            />
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-6">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
