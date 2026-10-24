# Verified integration status

Verification date: **2026-10-24**. No provider credentials were present. No claim below treats fixture data as a successful sponsor API call.

| Integration / track   | Distinct role                                                    | Implemented                                                                                                         | Verified here                                                                                                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Gemini                | Extract structured requirements from text or a private flyer/PDF | Official Google GenAI SDK, structured schema, configurable model, private file parts                                | Fixture text extraction only; live inference and file interpretation unverified                                          |
| Muse Spark            | Coordinate bounded model/tool loop and generate a cited plan     | Meta Model API Chat Completions adapter, configurable model, tool schemas, private reasoning discarded              | Fixture coordinator only; live inference unverified                                                                      |
| SerpAPI               | Venue research evidence and source references                    | Real search endpoint adapter, search ID, excerpts and links                                                         | Official-SDK MCP fixture transport verified; real SerpAPI request unverified                                             |
| Snowflake             | Workspace organization history and opted-in preferences          | Fixed parameterized SQL API query, read-only view and labeled demo seed SQL                                         | Fixture records verified; real Snowflake query unverified                                                                |
| Tiger Data            | PostgreSQL system of record and operational time series          | PostgreSQL migrations, optional TimescaleDB hypertable, actual bucket queries                                       | Local PostgreSQL-compatible persistence and `date_trunc` queries verified; managed Tiger Data / `time_bucket` unverified |
| Google Cloud Storage  | Private input and approved output objects                        | Official SDK, stable object keys, create-only preconditions, content verification on retry                          | Fixture file storage and crash-recovery semantics verified; GCS unverified                                               |
| Solana                | Devnet usage test credits                                        | Finalized RPC verification, genesis hash, exact transfer, signed payer, invoice/workspace memo, deduplicated ledger | Validation and duplicate-settlement tests passed; no real devnet payment submitted                                       |
| MCP                   | Trusted connector service and delegation interface               | Official TypeScript SDK, Streamable HTTP private tools, stdio delegation tools                                      | Actual local Streamable HTTP calls and both stdio delegation tools passed with the official SDK client                   |
| Vultr                 | Single-VM service hosting                                        | Dockerfile, Compose, separate processes, private connector network, Caddy TLS                                       | Build passed; Docker unavailable on build host; VM not deployed                                                          |
| `.tech`               | Public project domain                                            | Configurable Caddy domain and HTTPS setup                                                                           | Prepared only; no domain bought, registered, or DNS change made                                                          |
| Cursor                | Development support                                              | Repository rules ready for Cursor                                                                                   | Not used in this build. Do not submit a claim of use without a real session record.                                      |
| Grok Bot              | Independent development review                                   | Review prompt and evidence checklist in BUILD.md                                                                    | Not invoked. No fabricated review or response.                                                                           |
| SpaceXSI              | Honest development examples and branch                           | `spacex-ai` branch and evidence format                                                                              | Repository code and test results are real; no unsupported integration or challenge claim                                 |
| DEV writing challenge | Document the actual engineering work                             | Build journal, architecture notes, demo guide                                                                       | Local documentation created; no DEV article published                                                                    |

## Proof needed before claiming live use

Run the same published version in `RELAY_MODE=live`. Keep its run ID, pinned version, observed model steps, source row IDs, SerpAPI search ID, and source URLs. Confirm that the Snowflake context affects the plan and that a changed brief changes the search. Approve the exact private artifact write, then separately approve the exact public page. Keep the private GCS object reference and content hash. Capture the Tiger Data chart query and the finalized devnet transaction receipt if those tracks are claimed. Redact secrets and personal data before sharing evidence.

Using a synthetic dataset in a real Snowflake account proves a real infrastructure call, but does not make the dataset real participant history. Keep that distinction in the submission.

## Official documentation used

- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Meta Model API overview and model identifiers](https://dev.meta.ai/docs/overview)
- [Meta Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions)
- [Meta tool calling](https://dev.meta.ai/docs/tool-calling)
- [Official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
- [SerpAPI Google Search API](https://serpapi.com/search-api)
- [Snowflake SQL API requests](https://docs.snowflake.com/en/developer-guide/sql-api/submitting-requests)
- [Google Cloud Storage request preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
- [Tiger Data hypertables](https://www.tigerdata.com/docs/reference/timescaledb/hypertables/create_hypertable)
- [Solana transaction retrieval](https://solana.com/docs/rpc/http/gettransaction)
- [PGlite socket development server](https://pglite.dev/docs/pglite-socket)
