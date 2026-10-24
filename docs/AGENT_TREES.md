# Agent trees

Open **Workflows** in the sidebar, then select a tree page or use the plus button to create one. The user/orchestrator owns the task at the root. Select an agent to open its inspector.

## Manual builder

Enter a task. Use **+** to add a child. Edit its name, instructions, provider (`muse`), model identifier, and mode. Use **Connected to** to move a branch to a different parent. **Remove branch** removes the selected node and its descendants. The root cannot be removed.

**Save draft** persists the tree. **Publish & run** creates an immutable version and starts it through the native queue. The saved version also works with `POST /v1/runs` and the delegation MCP tools. Refreshing a saved tree or its selected run restores its state.

| Mode        | Behavior                                                                   |
| ----------- | -------------------------------------------------------------------------- |
| Orchestrate | Combine specialist results. The user/orchestrator root uses this mode.     |
| Reason      | Solve a focused task using previous visible results. No tools.             |
| Research    | Call explicitly selected SerpAPI web-search tool, then summarize evidence. |
| Review      | Check previous results for gaps, conflicts, and unsupported claims.        |

Modes are execution roles, not provider reasoning-effort settings. Each new node uses Meta / Muse Spark with a configurable model ID. Historical Gemini nodes remain readable but cannot be published as new configurations. Missing credentials and unsupported models fail visibly in live mode.

## Automatic planning

Select **Let an agent plan** and choose automatic or explicit complexity. The selected root provider/model plans a proposed team. Review the tree before publishing. Planning consumes one test credit through a durable run.

Fixture mode uses a labeled task-complexity heuristic. It produces two, five, or seven agents and makes no planning model call. Live mode calls the selected model and validates its JSON tree. Live Meta planning and a two-node tree were verified; see MUSE_LIVE_TEST.md.

## Movement and inspection

**Preview · simulated traffic** animates a proposed handoff. It does not mark work completed. **Persisted execution** follows actual run events and steps. Working nodes and incoming edges animate. Completed nodes have a distinct state.

Open the root to read the original task and team activity. Select a child for its own events, visible output, timing, configuration, and source evidence. Event details expose redacted observations. Private model reasoning is not recorded. The canvas supports scrolling, zoom, and Fit. On smaller screens, the inspector moves below it. Reduced-motion settings disable moving packets.

## Bounds

- Nine agents, five levels, and twelve read-tool calls maximum.
- One user/orchestrator root. Cycles, duplicate IDs, missing parents, and invalid permissions are rejected.
- Descendants execute sequentially. Parents synthesize after their children. Earlier visible specialist results also enter the context. This is not parallel execution or unrestricted delegation.
- Tree agents generate text and use approved read tools. They cannot send, book, buy, save artifacts, or publish pages. The existing event workflow retains exact-write approvals.
- Runs pin immutable tree versions. Completed tool observations restore evidence after a worker crash, even if the next checkpoint was not saved.
- The completion subset rejects tree workflows. Use the native runs API.

## API and verification

`POST /v1/trees` saves or publishes a dashboard-authenticated tree. Body: `{name, task, tree, publish, agentId?}`. An idempotency key prevents duplicate publication.

`POST /v1/trees/plan` starts a dashboard-authenticated planner and returns HTTP 202. Body: `{task, complexity, provider, model}`. It requires an idempotency key. Poll the returned native run; the proposal appears in `output.tree`.

See [workflow pages](UI_WORKSPACE.md) for page persistence, archives, the library, and the new page API. The original tree API remains for compatibility.

Run `npm test`. With the dev stack running, also run:

```sh
node --import tsx scripts/tree-smoke.ts
```

Tests cover validation, permission scopes, complexity sizing, workspace ownership, duplicate publication, immutable versions, missing live credentials, and crash recovery. The smoke script uses the actual HTTP API, worker, MCP service, and a temporary platform key in fixture mode.
