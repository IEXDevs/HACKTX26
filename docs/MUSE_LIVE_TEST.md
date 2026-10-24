# Muse live verification

Verified locally on 2026-10-24. Model: `muse-spark-1.3`. Endpoint: Meta Model API Chat Completions. The key stays in the ignored local `.env` file. Relay is now running with `RELAY_MODE=live`.

## Observed calls

| Call                     | Result                         | Provider-reported tokens | Duration |
| ------------------------ | ------------------------------ | ------------------------ | -------- |
| Direct connectivity test | Returned `ready`               | 131                      | 846 ms   |
| Invitation writer node   | Succeeded                      | 1,951                    | 5,128 ms |
| Orchestrator node        | Succeeded                      | 1,728                    | 5,261 ms |
| Automatic tree planner   | Returned a valid two-node tree | 2,293                    | 4,757 ms |

Tokens include the provider's total usage. They are not a cost invoice.

## Durable proof

- Saved agent: `agt_2548ef67e4cc04c4007a3faf` (Muse live test).
- Immutable version: `ver_2474ec7d03f58b782804d13b`.
- Executed tree run: `run_492885840cdbf2a73c358050`.
- Automatic planner run: `run_f33c4169afd6b18c2ffee72e`.
- [Open the executed tree locally](http://127.0.0.1:3000/?view=trees&tree=agt_2548ef67e4cc04c4007a3faf&treeRun=run_492885840cdbf2a73c358050).

The published tree used two Muse nodes and no tools. The worker executed both model calls. The output kept 80 attendees and the $3,000 budget, and left the date and venue unknown. It drafted an invitation without sending it. Each model step has `fixture: false`, timing, usage, and visible output.

Repeating the start request with its idempotency key returned the same run. Retrieving the run again preserved its output and succeeded state. The automatic planner also used a real model call. It returned the requested two Muse nodes with no tool permissions.

## Testing now

Open the saved Muse live test in Trees. Change the task, then run it. For other trees, select Muse on every node and clear external tool permissions until those providers are configured. Existing immutable versions keep their original models; publish a new version after edits.

Scope update: the new event template uses Meta for extraction and coordination, SerpAPI for search, and private disk storage. Gemini, Snowflake, GCS, Tiger Data, and devnet payments are deferred. Google Cloud deployment remains unverified. The original calls above remain valid historical proof. In live mode, missing providers fail explicitly. Relay does not replace them with fixtures.

The Connections page currently reports configured credentials as `configured · unverified`. Use the recorded run steps as proof of these successful calls; the page does not yet derive verification badges from run history.

## Verification after the stack reduction

The simplified adapter passed these additional live checks:

- PDF run `run_4a4e345c9e4ddbb91d69c6d1`, version `ver_community_meta_1`: extracted 83 attendees, a $2,700 budget, vegetarian food, and step-free access from a private, labeled demonstration PDF. Date and venue remained unknown. The step reported 3,506 tokens and 11,495 ms. The run remains paused for requirements review; no search or write approval was performed.
- Two-node tree `run_eb155b7af4b4fe5935dbb989`, version `ver_39918d88578d2e70d5ad6bb8`: writer and root succeeded with 1,965 and 1,866 tokens, respectively. Duplicate-start and persisted retrieval checks passed.
- Planner `run_0a655493281be686f5f77119`: generated a valid two-node Meta-only tree, reported 2,486 tokens and 9,062 ms.

The PDF was a generated test document with no real participant data. Its input was stored on private local disk, not GCS. Search was deferred at that check. A later live SerpAPI workflow passed; see [SERP_LIVE_TEST.md](SERP_LIVE_TEST.md). Google Cloud has not been deployed.
