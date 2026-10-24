# Relay build journal and challenge evidence

## What was built

On 2026-10-24, the supplied GitHub repository was empty. This foundation added a TypeScript Next.js dashboard/API, separate worker, official-SDK MCP connector service, PostgreSQL migrations, exact-content approvals, event replay, test-credit accounting, a Community Event Operations template, and a proposed participant event page.

The local runtime uses PGlite's PostgreSQL socket for a zero-Docker setup. Production Compose uses Tiger Data instead. A connection-release fix allows the web, worker, and connectors to share the serialized local development database. This is a real implementation tradeoff, not a claim that embedded development behavior proves production concurrency.

The first end-to-end fixture run used a changed attendee count, budget, and outdoor preference. The coordinator made actual MCP calls for synthetic organization and venue records. Both exact write approvals continued the run. A second run rejected the artifact action and produced no artifact. A short read-only saved agent also ran through `/v1/chat/completions`.

The regression suite exercises a crash boundary after the connector stores an approved artifact but before the worker persists its checkpoint. An expired worker lease is reclaimed. The retried action recovers the same artifact. No duplicate artifact or run debit is created.

## Build verification

Verification passed TypeScript, the production Next.js build, 18 runtime/security/payment tests, and an actual HTTP/MCP smoke run. A pending approval also survived a full local service and database restart. See `docs/VERIFICATION.md` for the recorded results. No live model, Snowflake, SerpAPI, GCS, Tiger Data, Vultr, or devnet payment credentials were available. Those claims remain unverified.

## Cursor and Grok Bot

This build was authored with Codex. It was not authored in Cursor and did not invoke Grok Bot. The Cursor rules file is a prepared development aid, not proof of Cursor use.

For a real Cursor session, record the date, task, files changed, human review, and commit. For a real Grok Bot review, request a review through the actual available service. Use a prompt such as:

> Review Relay's approval, idempotency, lease recovery, and devnet settlement code. Look for unauthorized writes, duplicate credits, cross-workspace access, secret exposure, and crashes between side effects and checkpoints. Give concrete file references. Do not infer successful sponsor use from fixture output.

Save the actual review link or transcript only after the interaction occurs. Record which findings were reproduced and fixed. No bot message has been posted on your behalf.

## SpaceXSI examples

The `spacex-ai` branch is a runnable branch of the same platform foundation. The `agents` branch is also runnable. Use the same setup commands on either branch. The hyphenated name is used because Git branch names cannot contain spaces.

Use the event operations example and the recovery test as honest development examples. Do not invent a SpaceX API call, a Cursor session, a Grok response, or an acceptance claim. Before submitting, check the actual challenge rules and add only evidence that exists.

| Evidence field    | Fill only after the work occurs                 |
| ----------------- | ----------------------------------------------- |
| Tool / model used | Exact product and model identifier              |
| Task              | Concrete requested change                       |
| Input             | Shareable prompt with secrets removed           |
| Result            | Actual code change, output, or issue found      |
| Verification      | Command, result, and commit                     |
| Human review      | Accepted, changed, or rejected; explain why     |
| Link              | Actual commit, run, review, or session artifact |

## DEV writing challenge draft

Suggested title: **Building Relay: reusable agent workflows with observable tools and exact human approvals**.

Suggested structure:

1. The problem: a one-off agent demo is hard to reuse or supervise.
2. The API promise: immutable published configuration plus a durable run ID.
3. The boundary: models choose bounded reads; humans authorize exact writes.
4. The hard part: recover after a side effect without duplicating it.
5. The trace: observed actions and evidence, with no private reasoning.
6. The honest demo: label fixtures, leave venue facts unknown, and show the failed paths.
7. Next steps: prove live providers, deploy on Vultr, and add production identity and controls.

Use the actual commit history, test results, screenshots, and verified integration table. Update the draft only with real provider evidence. This document has not been published to DEV.
