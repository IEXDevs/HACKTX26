# Relay

**Configure an agent once. Call it from your app. See and control every action.**

Relay uses **Meta for all models, SerpAPI for web search, and Google Cloud for hosting**. PostgreSQL and private files run on the same VM.

Relay is a working HackTX foundation for reusable, inspectable agent workflows. It includes a Next.js dashboard and API, a separate TypeScript worker, and a private connector service built with the official MCP TypeScript SDK.

The default local environment is **explicit fixture mode**. It runs the real database, queue, worker, MCP transport, approvals, event stream, API, and participant page. Model responses and source records are synthetic and labeled. It does not claim live sponsor use. See [verified integration status](docs/INTEGRATIONS.md).

## Start locally

Use Node.js 24 or later. Docker is optional for local development.

```sh
npm ci
npm run dev
```

Open [Relay locally](http://127.0.0.1:3000). The development supervisor starts:

| Process                        | Role                                                     |
| ------------------------------ | -------------------------------------------------------- |
| Next.js, port 3000             | Dashboard, workspace API, participant pages              |
| Background worker              | Durable execution; one checkpoint per phase              |
| Private MCP service, port 3101 | Validated tools, scoped SerpAPI reads, private artifacts |
| Local PGlite socket, port 5432 | Durable PostgreSQL-compatible development database       |

No environment file is required for fixture development. Local secrets are generated in ignored `.data/dev-secrets.json`. Data persists in `.data/postgres`; artifacts stay in `.data/artifacts`. The local database serializes clients and is for development only. Production Compose uses ordinary PostgreSQL on a Google Compute Engine VM.

Local development uses Next's Webpack server. This avoids a Turbopack file-watcher refresh loop observed in the Windows workspace after a standalone build. Production builds use the default bundler.

Live mode needs outbound HTTPS from the worker and connector processes. If search reports `SEARCH_NETWORK_DENIED`, restart `npm run dev` from a terminal with network access. Keys remain in `.env`; do not put them in the browser.

If port 5432 is busy, set a different port in `DATABASE_URL`. To use existing PostgreSQL, copy `.env.example` to `.env`, set `DATABASE_URL`, and set `RELAY_LOCAL_DB=false`. Do not run two development supervisors against the same embedded database.

## Try the main workflow

Open **Agents** for the searchable specialist library. Use the first tile to create an agent or select a card to configure one. Open **Workflows** for saved pages, run history, archives, and full-canvas execution. **Usage** groups observations by workflow, agent, and model. **Billing** is an explicit placeholder. API access is in the top bar; provider scopes are in Workspace settings. See [workspace layout and page API](docs/UI_WORKSPACE.md).

For manual and adaptive multi-agent workflows, create an agent-tree page in **Workflows**. Build branches, choose each agent's model and mode, preview moving handoffs, then publish and execute the saved tree. Open the root for team activity or a child for its observed result. See the [agent tree guide](docs/AGENT_TREES.md).

1. Open **Agents**. Inspect Community Event Operations. Configure or duplicate it. Publishing creates a new immutable version.
2. Run the published version with the supplied meetup brief. Each accepted run reserves one **test credit**.
3. Review extracted requirements. Change the attendee count, budget, location, or outdoor preference. Confirm to start research.
4. Inspect **Execution**, **Evidence**, and **Output**. The source records, search query, venue order, and budget allocations respond to the confirmed input.
5. Approve the exact `save_brief` action. The worker saves only its immutable content. Rejecting it prevents the write.
6. Separately approve `publish_page`. Open the proposed participant page from Output. Its Interested form records a labeled demonstration participant. It sends no invitation.
7. Refresh the dashboard. The run, events, evidence, and approvals remain in PostgreSQL.

Fixture mode accepts text briefs. Upload interpretation uses live Meta. Live PDF extraction is verified; image interpretation still needs live verification. No invitations, venue bookings, or purchases are implemented.

## Use the same agent through the API

Create a platform key through **API access** in the top bar. Give it run read/write scopes. Add `approvals:write` only if the API client should submit explicit human decisions. The dashboard shows the key once and stores its hash.

```sh
# Bash. In PowerShell use $env:RELAY_API_KEY='…'
export RELAY_API_KEY='your-platform-key'
npm run demo:api
```

The example starts `ver_community_meta_1`, prints its dashboard URL, asks you to confirm requirements, and displays the complete content before each approval. It does not approve writes automatically.

```sh
curl -X POST http://127.0.0.1:3000/v1/runs \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Idempotency-Key: meetup-001" \
  -H "Content-Type: application/json" \
  -d '{"versionId":"ver_community_meta_1","input":{"brief":"Meetup near UT Austin for 80 people within a $3,000 budget"}}'
```

The response is HTTP **202** with a durable run identifier. See [API contracts and examples](docs/API.md), including event replay, approvals, cancellation, the read-only completion subset, and MCP delegation.

## Verify

```sh
npm run typecheck
npm test
npm run build
# With npm run dev running in another terminal:
npm run test:e2e
```

Tests cover immutable versions, duplicated templates, duplicate request debits, workspace boundaries, exact approval hashes, duplicate decisions, denied tools, cancellation, approval expiry, recovery after an artifact write, and duplicate test-credit settlement. The smoke script exercises the actual Next.js API and MCP service, persisted refresh, SSE reconnection, changed inputs, approval/rejection, participant interest, and completion responses. It creates clearly labeled fixture executions in your local workspace. It refuses to run in live mode.

## Enable live providers

Copy `.env.example` to `.env`. See [environment variables](docs/ENVIRONMENT.md). Configure Muse Spark and SerpAPI, then set `RELAY_MODE=live` and restart services. Publish a version with model identifiers available to your account. Existing versions retain their original identifiers.

New templates are **Community Event Operations · Meta** and **Meta Text Assistant**. New trees use only Meta and optional SerpAPI reads. Old versions and run records remain intact. Republish a legacy configuration before using it live.

Missing credentials and provider failures produce visible failures. Live mode never falls back to fixtures. A configured connection does not prove a successful call.

## Deploy on Google Cloud

[Deployment guide](docs/DEPLOYMENT.md) covers one Compute Engine VM, Docker Compose, PostgreSQL, private disk artifacts, connectors, and TLS. The stack is prepared but has not been deployed by this build. Docker is not installed on the build host.

```sh
# On the VM, after configuring .env:
docker compose up --build -d
docker compose ps
```

For a local container setup with regular PostgreSQL:

```sh
docker compose -f compose.local.yaml up --build
```

## Project map

| Path                     | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `app/`                   | Dashboard, sign-in, native API, event pages                |
| `lib/store.ts`           | Workspace operations and transactional state changes       |
| `lib/runtime.ts`         | Leases, checkpoints, tool loop, bounded execution, writes  |
| `lib/models.ts`          | Meta extraction, tree inference, and coordination          |
| `services/connectors.ts` | Official-SDK MCP service and trusted integrations          |
| `services/worker.ts`     | Background queue processor                                 |
| `services/delegation.ts` | Public stdio MCP tools backed by platform keys             |
| `lib/payments.ts`        | Deferred legacy devnet validation; payment API is disabled |
| `db/migrations/`         | PostgreSQL schema and optional TimescaleDB hypertable      |
| `tests/`                 | Runtime, security, and payment regressions                 |

See [architecture and limits](docs/ARCHITECTURE.md), [demo script](docs/DEMO.md), and [build journal / challenge evidence](docs/BUILD.md). The `agents` and `spacex-ai` branches start from this runnable foundation. They use the same commands. The latter is a safe starting point for SpaceXSI development evidence; it does not claim a SpaceX data integration or fabricated tool use.

## Reduced scope

Gemini, Snowflake, Tiger Data, GCS, Solana payments, and Vultr are deferred. The connection screen shows only the active stack. Test credits remain an internal run allowance. Read [the editable plan](docs/PLAN.md).
