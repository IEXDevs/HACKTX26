# Active integration status

Scope changed on **2026-10-24**. Relay now targets Meta models, SerpAPI web search, and Google Cloud hosting. The earlier sponsor-wide architecture is deferred.

| Component             | Role                                                                                               | Verification                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Meta / Muse Spark     | All inference: extraction, tree planning, specialist nodes, root synthesis, and event coordination | Live two-node text tree, automatic tree planning, and PDF extraction passed. See [live proof](MUSE_LIVE_TEST.md). Live event extraction, model-selected search, and plan generation also passed up to the exact-write approval pause; see [SerpAPI proof](SERP_LIVE_TEST.md). Image extraction remains unverified. |
| SerpAPI               | Web search through the trusted MCP connector                                                       | Live Google Search through MCP passed: six real source URLs, search ID, and an evidence-backed three-option plan. See [live proof](SERP_LIVE_TEST.md).                                                                                                                                                             |
| Google Compute Engine | One VM hosts the Compose stack                                                                     | Deployment path prepared. No VM provisioned or deployed verification completed.                                                                                                                                                                                                                                    |
| PostgreSQL            | Persistent versions, runs, approvals, events, allowance, and usage chart                           | Local persistence and recovery tested. Production Compose uses ordinary PostgreSQL on the VM; production startup remains unverified.                                                                                                                                                                               |
| Private disk storage  | Input briefs and approved artifacts                                                                | Create-only atomic publication, stable-action recovery, duplicate content checks, and traversal rejection have regression tests. VM disk persistence remains unverified.                                                                                                                                           |
| MCP                   | Trusted tool boundary and API delegation                                                           | Official SDK Streamable HTTP and stdio delegation were verified locally.                                                                                                                                                                                                                                           |

The Connections page displays only the active stack. Configuration presence does not prove a successful live call. Run evidence remains the proof.

## Deferred work

Gemini, Snowflake organization history, Tiger Data / TimescaleDB, GCS, Solana payments, and Vultr are no longer required. New published configurations use Meta and SerpAPI only. Payments return HTTP 410 after authorization. Test credits are a local run allowance, not a currency.

Historical immutable versions and execution records remain intact. A historical version that needs a retired live provider fails explicitly; publish an updated version or use the new Meta template. Legacy fixture history and payment tests remain for compatibility and do not prove active integration use.

Cursor, Grok Bot, SpaceXSI, the `.tech` domain, and the DEV article retain their historical evidence status in BUILD.md. None is claimed as a completed provider integration or publication.

## Official references

- [Meta Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions)
- [Meta structured output](https://dev.meta.ai/docs/structured-output)
- [Meta image understanding](https://dev.meta.ai/docs/image-understanding)
- [Meta file input](https://dev.meta.ai/docs/file-handling)
- [SerpAPI Google Search](https://serpapi.com/search-api)
- [Google Compute Engine container deployment](https://docs.cloud.google.com/compute/docs/containers/deploying-containers)
