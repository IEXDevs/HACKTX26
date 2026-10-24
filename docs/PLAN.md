# Relay: reduced build plan

Goal: configure an agent once, call it through an API, and inspect and control its actions in the agent tree.

## Active stack

- Meta Model API for extraction, planning, and every agent node.
- SerpAPI for web search and source evidence.
- Google Compute Engine for hosting one Docker Compose stack.
- Next.js web/API, separate TypeScript worker, and official-SDK MCP service.
- PostgreSQL and private artifact files on persistent VM storage.
- Local test allowance only. No wallet or payment integration.

## Current work

- [x] Save, duplicate, publish, and run immutable agent versions.
- [x] Inspect model/tool steps, results, evidence, usage, errors, and approvals.
- [x] Edit manual trees and generate a tree through live Meta planning.
- [x] Use Meta-only defaults and SerpAPI-only tool choices.
- [x] Preserve approval, cancellation, idempotency, and recovery boundaries.
- [x] Replace external artifact storage with private disk storage.
- [x] Prepare one-VM Google Cloud Compose deployment.
- [x] Verify real SerpAPI calls and evidence-backed plan generation through the native API.
- [ ] Verify a complete live event run and both approved writes.
- [x] Verify PDF extraction with live Meta and private disk input storage.
- [ ] Verify image extraction with live Meta.
- [ ] Deploy to Google Cloud and test persistent volumes, TLS, and restarts.

## Next product improvements

- [ ] Root task chat and follow-up instructions.
- [ ] Concurrent independent agent branches.
- [ ] Per-node retry and explicit dependencies.
- [ ] Connection verification derived from execution history.
- [ ] Production user identity, roles, rate limits, retention, and key expiry.

## Deferred

Gemini, Snowflake organization history, Tiger Data, Google Cloud Storage, Solana payments, Vultr hosting, and sponsor-specific expansion. Existing immutable versions and records remain intact. New configurations reject retired providers. No claim is made that the original sponsor-wide acceptance criteria are complete.

## Four-tab workspace update

- [x] Agents library with search, role filters, and a side-by-side creation form.
- [x] Workflows index with dedicated canvas pages, drafts, history, archive/restore, and plus-button creation.
- [x] Add a reusable library specialist to a manual tree.
- [x] Actual usage and diagnostics grouped by workflow, agent, and model.
- [x] Billing placeholder without payment collection.
- [x] Keep API access and provider settings available outside the four main tabs.
