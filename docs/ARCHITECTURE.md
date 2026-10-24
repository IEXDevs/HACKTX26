# Relay architecture

The active stack is TypeScript / Next.js, a separate worker, official-SDK MCP connectors, Meta models, SerpAPI, and PostgreSQL. Production targets one Google Compute Engine VM with Docker Compose. Private files stay on its persistent disk. See [deployment](DEPLOYMENT.md).

## Execution

PostgreSQL stores drafts, immutable published versions, runs, checkpoints, ordered events, observed steps, approvals, artifact references, platform key hashes, local allowance, and participant interest. Database triggers reject changes to published versions and approval content.

Workers claim queued runs with row locks and `SKIP LOCKED`. Each phase commits a checkpoint. Approval and requirements pauses release the worker lease. Active-execution deadlines are separate from approval expiries. An expired execution lease recovers within 90 seconds and charges its lost time to the active budget.

Meta extracts structured requirements from text or inline PDF/image inputs. The organizer corrects them before research. Meta then selects approved SerpAPI reads in a bounded tool loop and returns a cited event plan. The server validates source IDs and budget allocations. Search snippets never confirm operational prices, capacity, or availability.

Trees use Meta on each node. Descendants execute sequentially before parent synthesis. Each node can generate text or use its selected SerpAPI read tool. Nodes cannot save files or publish pages. Automatic planning makes a separate durable Meta call, and the user reviews the proposed tree before publication.

## Tools and credentials

The model can request only `venue_search`. The worker validates arguments and the pinned version's allowlist. The connector checks the active run and permissions again. It accepts search text, not arbitrary endpoint URLs. No organization-history provider is required.

The production worker receives the Meta key. Only the connector receives the SerpAPI key and artifact disk. The web receives neither provider key. Platform API keys are hashed and scoped to one workspace. They are separate from the internal connector secret and provider credentials. Local development inherits `.env` for convenience; no provider secrets are sent to browser bundles or traces.

Visible telemetry includes model results, tool calls, source evidence, short decision summaries, errors, timing, and usage. Private reasoning fields are discarded. Internal conversation checkpoints are not returned by the run API.

## Approval and recovery

The event workflow pauses separately for `save_brief` and `publish_page`. Each approval pins exact content and a content hash. Write tools accept stable action IDs and load content from the approved record. They never accept replacement content from the model.

Disk storage writes a complete temporary file, syncs it, then publishes it with a create-only hard link. Retrying the same key returns the existing result only if the content matches. `local://` labels real disk artifacts; `fixture://` labels fixture artifacts. Only the authenticated artifact API reads them. A unique action key prevents duplicate artifact records. Public event pages use the approved action ID as their primary key.

Writes hold the run row lock. Cancellation waits for an already-started approved write, then prevents later work. It does not undo a completed write. Completed observed tool results are reused after recovery. An inference or search may repeat if a worker dies before recording its result; usage can undercount these ambiguous calls.

Run creation atomically stores the run, idempotency record, event, and one allowance debit. Duplicate requests do not debit twice. Duplicate approval decisions recover the existing result. Rejection prevents subsequent writes. Ordered event IDs support stream reconnection.

## Telemetry and scope

The Usage chart queries actual completed steps with PostgreSQL `date_trunc`. No metrics are seeded. Fixture executions report zero model tokens. Model cost remains a rough configured estimate.

Gemini, Snowflake, Tiger Data, GCS, Solana payments, and Vultr are deferred. Legacy schema and historical versions remain readable. New versions reject retired providers and tools. Payments are disabled; test credits have no monetary value.

Known limits: tree execution is sequential; root interaction is an inspector, not chat; image input and live approved writes still need proof; production Compose has not been run; the VM is a single point of failure. The local embedded database serializes clients and does not prove production concurrency. Real user identity, roles, rate limits, password throttling, key expiry, retention, and abuse controls remain future work.
