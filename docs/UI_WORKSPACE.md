# Relay workspace

The sidebar has four destinations, in this order: **Agents**, **Workflows**, **Usage**, and **Billing**. API access lives in the top bar. Provider availability and connection scopes live in Workspace settings.

## Agents

Open `/agents`. The left pane is a searchable library. Filter by research, writing, review, or your saved agents. The right pane creates and configures an individual specialist. It includes name, description, instructions, Meta model ID, execution role, and optional SerpAPI read permission.

The seeded library includes Research analyst, Thoughtful writer, Quality reviewer, Project planner, and Data analyst. These are real saved configurations with published versions, not fabricated executions. Existing templates and user agents remain available. Retired-provider templates are labeled Legacy and cannot start through the library shortcut.

Save a draft or publish an immutable version. Select **Use agent** to create a workflow page pinned to its version. Complete workflow templates are edited on their workflow pages; the specialist form does not flatten a full team into one agent.

## Workflows

Open `/workflows`. View all active pages, filter to running work, or open Archived. Each page has a real `/workflows/:id` URL. The plus button creates a blank agent-tree page or an individual-agent page. Creating a page does not start provider calls.

The migration backfills existing saved trees and previous runs into pages. Historical runs remain pinned to their original versions. A page's history selector opens any of its runs. Native API runs also attach to a workflow page.

The diagram fills the main workspace. Click a node to open its inspector; close it to reclaim canvas space. Add a reusable library agent, add manual children, or ask the planning agent to propose a tree. Save the draft, then publish and run. Automatic planning itself is a model run and uses one local test credit.

Archiving hides a page from the normal list. It preserves its draft, versions, run history, and approvals. It does not cancel an active run. Archived pages cannot start new runs. Restore the page to continue editing and launching work. Existing execution approvals remain accessible from run history.

The event workflow retains requirements review, source evidence, exact save approval, and separate publication approval. Archiving does not grant an approval. Pending approval content remains immutable.

## Usage and Billing

Usage shows persisted observations by workflow, agent, and model, plus failed-step diagnostics. Choose 24 hours, seven days, or all time, and all/live/fixture modes. The activity chart separately shows completed steps for the last 24 hours across all modes. Fixture model tokens stay zero. Model totals include provider-reported usage; costs are not invoices. Calls lost before an observation commits can be missing.

Billing is an explicit placeholder. It shows the internal test allowance. Relay does not collect payments or activate subscriptions. The user's Meta and SerpAPI accounts remain responsible for provider usage.

## API additions

These page-management routes require dashboard authorization and the existing same-origin mutation checks. Provider keys and scoped platform keys do not grant production dashboard access.

| Route                         | Behavior                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/agents`             | Create a library draft or published agent. Body `{name,description,config,publish}`; requires an idempotency key.                                                                                     |
| `GET /v1/workflows`           | List active and archived page metadata, run counts, and latest states.                                                                                                                                |
| `POST /v1/workflows`          | Create `{name,kind:'tree'                                                                                                                                                                             | 'agent',task?,tree?,versionId?}`; requires an idempotency key. Individual-agent pages require a workspace-owned published version. |
| `GET /v1/workflows/:id`       | Read the saved draft, selected configuration, and run history.                                                                                                                                        |
| `PATCH /v1/workflows/:id`     | Update `{revision,name?,task?,tree?,versionId?,archived?}`. A stale revision returns 409.                                                                                                             |
| `POST /v1/workflows/:id/runs` | Submit `{revision}` and an idempotency key. Returns 202. Atomically publishes a tree snapshot when needed, creates the run, and reserves one allowance debit. Duplicate launches return the same run. |
| `GET /v1/diagnostics`         | Workspace-scoped aggregates. Query `range=24h                                                                                                                                                         | 7d                                                                                                                                 | all`, `mode=all | live | fixture`. |

Native `POST /v1/runs` still accepts a published version. Optional `workflowId` attaches it to a workspace-owned, non-archived page. Without it, Relay associates ordinary runs with their agent's default workflow page. Planning-only runs stay in telemetry without creating extra pages.

## Verification

Run `npm test` for authorization, stale-update, archive/restore, immutable-version, duplicate-debit, and diagnostics regressions. With the stack in fixture mode, run:

```sh
node --import tsx scripts/workflow-smoke.ts
```

This HTTP smoke test covers agent creation, publication deduplication, page creation, PATCH draft updates, stale conflicts, execution, duplicate launch, archive/restore, preserved history, and diagnostic groups. Existing event, tree, and API smoke tests remain available.

Known limits: tree execution is sequential; root chat and per-node retries are not implemented. The new page editor currently takes task text. Flyer/PDF uploads remain available through the native upload/runs API. Billing is not configured. The shared-password prototype is not a production identity system.
