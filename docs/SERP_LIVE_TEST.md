# Live Meta and SerpAPI verification

Verified on 2026-10-24 in local `RELAY_MODE=live`. Provider credentials stay in the Git-ignored `.env` file. No credential is recorded here.

- Run: `run_65e59448ccfbf4675e7e1b3c`.
- Published version: `ver_community_meta_1`.
- Model: `muse-spark-1.3`.
- SerpAPI search ID: `6add1b8f136b1aea1af39c37`.
- [Open the run locally](http://127.0.0.1:3000/?view=runs&run=run_65e59448ccfbf4675e7e1b3c).

## Observed workflow

A labeled demonstration organizer brief requested a welcoming meetup near UT Austin for 80 people within a $3,000 event budget. Preferences included step-free access, vegetarian food, a quiet area, and small-group introductions. The date remained unknown.

The test used a temporary scoped Relay API key to start the published agent. A duplicate request returned the same run. Live Meta extraction preserved the count, budget, preferences, and unknowns. The test confirmed these demonstration requirements, then the worker continued.

Muse selected `venue_search` with the query `accessible community event venues near UT Austin step-free vegetarian`. The trusted connector made a real SerpAPI Google Search call over the official-SDK MCP transport. It returned six source references with `fixture: false`, a real search ID, and source URLs.

The model compared University Unions Event Spaces, Commons Conference Center, and Amala Sanctuary. The provisional recommendation cited the [University Unions source](https://universityunions.utexas.edu/reserve). Other compared sources were [Commons Conference Center](https://commons.utexas.edu/) and [Amala Sanctuary](https://www.sanctuaryeventspace.com/). These are search evidence, not confirmed quotes, capacities, availability, eligibility, catering, or accessibility guarantees.

The server kept prices, capacity for 80 people, and availability explicitly unknown. The output includes the plan, budget allocations, unsent invitation drafts, and unresolved details.

| Observed step                | Result    | Provider-reported tokens | Duration  |
| ---------------------------- | --------- | ------------------------ | --------- |
| Meta requirements extraction | Succeeded | 1,855                    | 7,116 ms  |
| Muse tool selection          | Succeeded | 1,419                    | 1,692 ms  |
| SerpAPI search through MCP   | Succeeded | 0                        | 1,534 ms  |
| Muse evidence-backed plan    | Succeeded | 4,959                    | 12,737 ms |

Token counts are total provider usage, not monetary charges.

## Approval boundary

The run is `awaiting_approval` for exact `save_brief` action `run_65e59448ccfbf4675e7e1b3c_save_brief`. Its content hash is `cb916f6f0602f265516dfa12bf3ef4bb77b03ee9468f97b9182952cf07b930ea`.

Retrieving the run again preserved the same pending action and hash. No artifact was saved, no event page was published, and no invitation, booking, or purchase occurred. A human must approve the exact content in the dashboard before saving; page publication requires a separate approval. The temporary API key was revoked after the test.

This proves live extraction, model-selected search, real source evidence affecting the plan, scoped native API execution, duplicate-start recovery, persisted retrieval, and the pause before writing. It does not prove live approved writes or Google Cloud deployment. Configuration-only connection badges remain separate from this execution proof.
