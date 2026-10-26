# Codebase cleanup review

This pass fixes runtime errors and simplifies shared team traversal. It adds 19 regression tests. The initial suite had five failing tests. All five now pass.

## Changes made

- Honor each agent's saved step limit. Remove the helper that raised it to the global default. Use the same limit for execution and motivator reviews. This restores final-report turns and preserves failed delegate findings.
- Commit each audit event and its run counter in one SQLite transaction. Advance the in-memory sequence and hash only after the transaction succeeds. A failed write can then retry without a gap or an orphaned event.
- Preserve earlier projections when an agent pauses for input. Replace the changed agent entry instead of mutating the shared object.
- Check workspace ownership before opening a run event stream. Reject missing and foreign runs with the same response.
- Release stream timers and listeners on cancellation, abort, replay failure, and completion. Use the EventSource reconnect header and reject invalid sequence values. Keep replay and live-event deduplication.
- Share one iterative descendant traversal across publishing, workflow views, and graph data. Index parent links once. Preserve depth-first order and archived-agent filtering. Stop at cycles without recursive calls.

## Verification

- Core: 70 tests pass in 9 files.
- Web: 374 tests pass in 60 files. Three live Docker checks are opt-in.
- Workspace TypeScript checks pass. The final production build also passes its TypeScript check.
- ESLint and React Hooks checks pass with zero warnings.
- Production build succeeds without the three filesystem-tracing warnings.
- The standalone package starts and applies all 15 migrations at a custom database path.
- New tests cover transaction rollback, concurrent event writes, logger reopening, projection isolation, stream ownership and cleanup, reconnects, replay races, tree order, cycles, and a deep tree.

The checks use local fixtures and an in-memory database. They do not exercise live model providers, OAuth accounts, or a deployed server.

## Follow-up implementation

The follow-ups below are now implemented. Live container verification still needs a Linux Docker runtime; this machine has no Docker, Podman, or WSL installation.

| Priority | Observation | Implemented change and check |
| --- | --- | --- |
| High | HTTP redirects and response reads lacked complete bounds. | The new HTTP helper validates every redirect, caps redirects, shares one timeout, and cancels response reads at 256 KB. Local HTTP fixtures cover allowed and blocked redirects, protocol changes, loops, oversized bodies, stalled requests, and reader cleanup. |
| High | Agent commands ran with the server's OS access. File tools used lexical paths. | Commands now require a non-root, networkless Docker container with one workspace mount, a read-only root, resource limits, an internal deadline, and forced cleanup. There is no host fallback. File tools check real symlink targets and root directories. Unit tests pass; three live container tests are ready in `pnpm sandbox:verify`. See the command isolation guide. |
| Medium | Every model tool received the same broad argument schema. | The shared manifest now uses one Zod argument contract per tool. Connector payloads remain extensible. All 21 public tool examples are tested. The serialized manifest must remain below 60% of a conservative legacy fixture. Case tools have their own schemas. |
| Medium | Template creation duplicated the factory. Runtime responsibilities accumulated in the orchestrator. | Template creation now uses explicit template options on the shared factory, with atomic graph, budget, and audit writes. Tests preserve provenance, ranks, grants, prompts, connectors, budgets, and duplicate-name handling. Routing, tool specs, delegation helpers, and checkpoint persistence now live in focused modules. Existing approval and pause/resume tests pass. |
| Medium | Dynamic database checks traced unnecessary project files. | Migration paths are scoped and included explicitly. A build packaging step removes local runtime state from instrumentation traces and standalone output, because Next 16 bypasses route exclusions for instrumentation. The app uses a standalone package. A smoke check rejects copied databases and environment files, starts the compiled server, and verifies every migration at a custom database path. |

`pnpm lint` now runs ESLint 10, TypeScript rules, and the Rules of Hooks and dependency checks. Lint fixes removed unused declarations and stale disable comments. The builder uses a stable callback for its voice-error effect. Voice cleanup captures its generation ref explicitly. Type checking remains a separate command.

## Runtime setup

Use Node 22.13 or later. For command tools, install a Linux Docker runtime, run `pnpm sandbox:build`, then run `pnpm sandbox:verify`. The server must run as a non-root user. See [command isolation](command-isolation.md) for deployment details. File and connector tools remain available without Docker; command tools return a setup error.

Run `pnpm build` followed by `pnpm verify:package` to verify the standalone deployment. The Docker application image now uses that package and a non-root user. Its Linux image build and live daemon connection still need verification on a Docker-enabled host.
