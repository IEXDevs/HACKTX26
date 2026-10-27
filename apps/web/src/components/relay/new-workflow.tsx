"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { WORKFLOW_MODES, type WorkflowMode } from "@/lib/workflow-mode";
import type { LibraryAgent } from "@/lib/workflow-selection";
import { WorkflowBuilder } from "./workflow-builder";

export function NewWorkflow({ library, accountScope }: { library: LibraryAgent[]; accountScope: string }) {
  const [mode, setMode] = useState<WorkflowMode | null>(null);
  if (mode) return <WorkflowBuilder key={mode} accountScope={accountScope} mode={mode} library={library} onBack={() => setMode(null)} />;

  return (
    <div className="page">
      <Link href="/workflows" className="glass-pill"><ArrowLeft size={16} aria-hidden />Workflows</Link>
      <div className="page-top" style={{ marginTop: 24 }}><h1>New workflow</h1></div>
      <p className="muted">Choose how to build the agent tree.</p>
      <div className="tile-grid spaced workflow-modes">
        {WORKFLOW_MODES.map((option) => (
          <button key={option.id} className="tile workflow-mode" onClick={() => setMode(option.id)}>
            <span className="tile-main"><b>{option.name}</b><span>{option.description}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
