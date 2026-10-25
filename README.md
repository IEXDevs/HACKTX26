# Astronom

**An internal platform for building, routing, guarding, evaluating, and observing AI agents.**

Astronom is a working implementation of the enterprise agent-platform brief: a reusable
agent blueprint, four connector types, two-layer prompts, security-aware model routing,
task-heaviness hardware envelopes, budget-aware downgrades, a human permission gate,
trace-scored evaluations, auto-healed guardrails, and a live execution graph.

Everything is real enough to inspect. Runs execute tools against a per-agent sandbox on
disk, approvals pause the actual engine, budgets halt it, and every observable fact is an
append-only, hash-chained event.

## Start

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The first request migrates and seeds the local SQLite
database in `apps/web/.data/`. No API keys are needed: the default planner is
deterministic and every tool call still executes for real.

```sh
pnpm typecheck
pnpm test
pnpm build
```

## What to try

1. **Trigger a run.** Use the `trigger` menu in the top bar: an event webhook, a scheduled
   sweep, or a manual request. All three enter through the same run API.
2. **Watch the trace.** The run page streams the event log over SSE. The router decision
   shows the chosen model, the hardware envelope, and the rejected candidates.
3. **Approve a gate.** A high-risk tool pauses the run with a real approval row. Approve or
   deny it from the run page or the security queue; the engine resumes from the database.
4. **Run an evaluation.** Open **Evaluations** and score a suite. Cases are matched to real
   recorded traces; a case with no similar trace fails.
5. **Auto-heal.** The eval page turns open high/critical findings into locked org prompt
   blocks, attaches them to every agent, and marks the finding fixed.
6. **Inspect the sandbox.** Open an agent's **Console** to read and edit its real workspace
   directory. Writes are path-guarded and audited.
7. **Change the blueprint.** Use the builder to create an agent from a template, edit the
   prompt stack, publish/pause an agent, or inspect grants and model policy.

## Repository layout

```
apps/web/                 Next.js 16 App Router workbench + API routes
  src/app/                overview, graph, runs, security, evals, build, connectors, policy
  src/app/api/            runs (SSE), approvals, evals, auto-heal, findings, sandbox, agents
  src/lib/runtime/        engine, scripted/live gateways, policy, budget, sandbox, evals
  src/lib/db/             Drizzle schema, migrations, deterministic seed
packages/core/            shared protocol, model router, budget ledger, event projection
  src/protocol/           agents, events, models, permissions, tools
  src/runtime/            hash chain, projection, budget, path-safe sandbox helpers
```

## The 12 pillars, as implemented

| Pillar | Where it lives |
| --- | --- |
| Use case / template | `templates` + builder; instantiate through `POST /api/agents/from-template` |
| Connectors | MCP, REST, allowlisted CLI, retrieval, web search in the connector registry |
| Context | Knowledge-base documents surfaced as suggested context; retrieval is labelled untrusted |
| Hardware / resources | `hardwareForComplexity()` maps task complexity to a light/medium/heavy envelope |
| Evaluations | Suites scored against recorded traces; tool accuracy, task success, intervention rate |
| Trigger | Top-bar manual, webhook, and schedule triggers; all use `POST /api/runs` |
| Model | Data-class-aware router; confidential/restricted data prefers in-VPC models |
| Budget | Run and daily ledgers; at 75% the router downgrades the step and injects a wrap-up directive |
| Guardrails | Default-deny policy, standing grants, per-run approval for high/critical risk, secret leases |
| Prompt | Locked company blocks, team blocks, and agent instructions resolved by `resolvePrompt()` |
| Observability | Hash-chained event log, SSE stream, run trace, graph, budget and approval events |
| Auto-heal | Findings become locked org guardrail blocks attached to every agent |

## Operating notes

- **Scripted vs live.** The default gateway is `scripted`; the plan is deterministic and
  every tool call runs through the production executor. A capped hackathon key for
  Meta Model API is hardcoded in `apps/web/src/lib/env.ts` (`OPENAI_BASE_URL` defaults
  to `https://api.meta.ai/v1`), so dispatching with mode `live` just works everywhere
  with no setup; set `OPENAI_API_KEY` / `OPENAI_BASE_URL` env vars to override.
  The workspace model policy only allows Meta models, so live runs route to Muse.
  Without a key it falls back to scripted (check the run's `mode`). Reasoning models
  burn completion tokens thinking, so live steps cost ~400-600 tokens each against
  the run budget ceiling.
- **Storage.** Local data is SQLite (`DATABASE_URL=file:./.data/agent-os.db`). Agent
  sandboxes live under `.runtime/workspaces/`.
- **Secrets.** Credentials are encrypted at rest with AES-256-GCM. The local development
  key is derived; production requires `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, base64).
- **Reset.** `pnpm db:reset` deletes the local database; the next request reseeds the
  demonstration workspace.
