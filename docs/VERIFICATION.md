# Verification record

Date: 2026-10-24. Active scope: Meta models, SerpAPI search, Google Cloud hosting, PostgreSQL, private disk storage, Next.js, separate worker, and official-SDK MCP service.

| Check                             | Result                          | Scope                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                        | Passed                          | Web/API, services, scripts, tests                                                                                                                                                                                                                                                                 |
| Production build                  | Passed                          | Next.js 16.4.3 routes and optimized output, after the final UI changes                                                                                                                                                                                                                            |
| Unit and runtime tests            | 45 passed                       | Immutable versions, workspace boundaries, approvals, run debits, recovery, permissions, Meta request shapes, private storage, safe search errors, and retained legacy payment validation                                                                                                          |
| HTTP event workflow               | Passed in explicit fixture mode | Native 202, scoped platform key, duplicate debit, corrected requirements, changed query/recommendation, SerpAPI fixture evidence, both exact approvals, duplicate decisions, artifact retrieval, refresh, replay/SSE reconnect, participant interest, rejection, completion, and stdio delegation |
| Seven-agent tree smoke            | Passed in explicit fixture mode | Planner, save/publication idempotency, scoped native key, per-node execution, one MCP search read, sources, root synthesis, refresh, and no writes                                                                                                                                                |
| Live Meta                         | Passed                          | PDF extraction, two-node tree, automatic tree planning, and event research coordination; see MUSE_LIVE_TEST.md and SERP_LIVE_TEST.md                                                                                                                                                              |
| Live SerpAPI                      | Passed                          | Native API run, model-selected MCP search, six real source URLs, evidence-backed three-option plan, exact-write approval pause; see SERP_LIVE_TEST.md                                                                                                                                             |
| Google Cloud / production Compose | Not run                         | No cloud deployment performed; Docker is unavailable on the development host                                                                                                                                                                                                                      |
| Earlier visual browser check      | Not run                         | Browser tool policy blocked access to the existing tab. No alternate browser workaround was used. Build and API checks passed; no new visual verification is claimed.                                                                                                                             |
| Formatting and whitespace         | Passed                          | Prettier and git diff checks                                                                                                                                                                                                                                                                      |

The simplified fixture event run was `run_55bb5dbc5d614c445dce2d48`; rejection run `run_bf3042fb44111dfda82fe510`. The seven-agent tree run was `run_edaeda61d058cf04a4c15639`.

Recovery tests record an approved live-disk write, expire the worker lease before checkpoint, then recover the same artifact without duplication. The model content stays labeled synthetic in that isolated test. Storage tests also exercise racing identical writes, changed-content rejection, fixture labels, and path traversal rejection. These simulate worker failures; they do not prove VM power-loss recovery.

The earlier foundation also passed a full local restart with an approval pending. Historical screenshots relay-run.jpg and agent-tree-run.jpg record the earlier fixture UI, which included providers now deferred. They are not screenshots of the reduced stack.

Solana transaction validation and settlement tests remain regression coverage for historical code. The active payment endpoints return 410 after authorization; no real devnet transfer has been tested. No removed sponsor integration is claimed as active.

To repeat the pending-approval restart check, use `node --import tsx scripts/restart-check.ts record <runId>`, stop and restart the stack, then run `node --import tsx scripts/restart-check.ts verify`. This helper stores no keys.

## Four-tab layout verification

The new Agents / Workflows / Usage / Billing interface passed browser checks. The library filters by search and role, creates and publishes a specialist beside the results, and starts a separate individual-agent page. A real Muse run (`run_778fa6f6ce8f5a8c12a28a18`) completed both specialist and orchestrator steps through that page. No invitation or external write was made.

A six-node demonstration tree page (`wf_890d2175efbbc5f374d13499`) saved a library writer, preserved it after refresh, archived, and restored. Usage displayed real workflow/agent/model groups and execution-mode filters. Billing remains a placeholder. Desktop and mobile layouts were inspected. Screenshot: `relay-agents-workspace.png`. The canvas was inspected before the service restart; a later stale browser error page blocked the second screenshot. No workaround was used.

The two added runtime tests cover page ownership, stale-revision conflicts, archived launch rejection without cancelling an existing run, duplicate launch debits, immutable execution snapshots, library creation deduplication, workflow/library version isolation, and diagnostic workspace isolation. `scripts/workflow-smoke.ts` passed actual HTTP checks, including PATCH updates, using page `wf_fc6e11e97348ec0c0c3b24ba` and run `run_b963bb4f0770c1ae3240da30` in explicit fixture mode. The event smoke also passed, and the existing live approval survived a full stack restart unchanged.

## Development refresh loop

The Windows development server repeatedly rebuilt and reloaded `/agents` after a standalone build. Requests still returned 200, but the browser stayed on the workspace loading screen. Switching both development commands to Next's supported `--webpack` mode stopped the loop. TypeScript now excludes runtime data and standalone output. After restart, the Agents page loaded, search retained its value across several polling cycles, and the browser reported no errors. TypeScript, formatting, and all 33 tests passed again.

## Live search network recovery

Run `run_1510e1ecaeb1efc07ec9ba50` failed because its connector process had no outbound network permission (`EACCES`). The same query returned HTTP 200 with network access. After restarting the stack with network access, the saved hardware workflow completed as `run_05d451725698cd63eab32534`: one real MCP search returned six SerpAPI sources (search ID `6add2b757e7028cec79e8e03`), followed by two successful Meta model steps. The original failure remains in history. No fixture fallback occurred.

The connector now returns fixed error codes and safe messages for network denial, network failure, timeout, credentials, quota, provider errors, empty results, and malformed responses. It never forwards raw provider bodies or request URLs. Twelve added tests exercise these outcomes and credential redaction; all 45 tests passed.
