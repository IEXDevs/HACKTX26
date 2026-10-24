# Verification record

Date: 2026-10-24. Environment: Windows, Node.js 26.12.0, Next.js 16.4.3, TypeScript 5.9.3. The lockfile records the exact installed dependencies.

| Check                  | Result                                           | Scope                                                                                                                                                   |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | Passed                                           | Web, API, services, scripts, and tests                                                                                                                  |
| `npm test`             | 18 tests passed                                  | Isolated PostgreSQL-compatible database, actual official-SDK MCP server/client, approvals, recovery, tool failure, payment validation and deduplication |
| `npm run build`        | Passed                                           | Optimized Next.js production build and route collection                                                                                                 |
| `npm run test:e2e`     | Passed                                           | Actual running web API, worker and private MCP service in explicit fixture mode                                                                         |
| Browser check          | Passed at initial mobile and desktop breakpoints | Dashboard renders with responsive navigation and real local run data                                                                                    |
| Full service restart   | Passed                                           | Pending approval, exact hash, active execution budget, and events survived web/worker/connector/database shutdown and restart                           |
| Docker Compose / Vultr | Not run                                          | Docker is not installed; no VM or domain credentials were available                                                                                     |
| Live sponsor providers | Not run                                          | No provider credentials were present                                                                                                                    |

The HTTP/MCP smoke test verified: workspace API key, HTTP 202, duplicate run request, input correction, changed search query, changed fixture recommendation, both MCP source types, exact artifact approval, duplicate approval, separate page approval, private artifact retrieval, persisted run retrieval, event cursor replay, terminal SSE reconnection, demonstration participant interest, rejection preventing a write, a saved read-only completion task, and both stdio delegation tools through the official MCP client.

The browser test started the same `ver_community_1` agent, corrected the attendee count to 84, confirmed requirements, selected an actual venue-research step, and inspected the pending write. After a full stack restart, the same action remained pending. The screenshot in `relay-run.jpg` records this fixture execution.

To repeat the restart check, pause a run at approval, then use `node --import tsx scripts/restart-check.ts record <runId>`. Stop and restart the services. Run `node --import tsx scripts/restart-check.ts verify`. The helper stores no keys.

Runtime tests verify the write recovery boundary by executing the approved artifact tool, expiring the lease before its worker checkpoint, and reclaiming the run. The recovered run uses the same artifact. This is a controlled crash simulation, not a production VM failure test.

Payment tests validate transaction structures and atomic ledger settlement separately. They do not claim that a real devnet RPC transaction was submitted or finalized. The live API always calls the RPC verifier before invoking the internal settlement function.
