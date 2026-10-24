# Relay demo script

Target: four to six minutes. State the environment at the start: **fixture demonstration** until live providers have been verified.

1. **Configure once.** Open Agents. Use Community Event Operations · Meta. Show instructions and Meta model IDs, tool scopes, active deadline, approval expiry, and output format. Duplicate the template. Change a preference and publish a new version. Point out the immutable version ID.
2. **Start with a real input.** Use: “Plan a welcoming meetup near UT Austin for 80 people within a $3,000 budget. Include vegetarian food, step-free access, and quiet introductions.” In live mode, attach the organizer's flyer/PDF. In fixture mode, explain that text extraction is synthetic and file interpretation is disabled.
3. **Correct what the model understood.** Show the requirements review pause. Change to 96 attendees and a $2,400 limit, and add “outdoor.” Confirm. Show that the actual venue search query uses those values. The fixture coordinator prioritizes the fictional garden option; a live run must cite its actual sources.
4. **Inspect execution.** Show the tree from User through extraction, organizer review, coordinator turns, and MCP reads. Click a tool step. Show its redacted arguments, source evidence, timing, mode, and usage. Show that planned writes look different from observed steps.
5. **Keep unknowns honest.** Open Output. Compare three options. Show source IDs, the provisional recommendation, budget allocations, schedule, unsent invitation drafts, and unresolved date/venue details. Emphasize that a search snippet does not confirm an all-in quote or capacity.
6. **Control the exact action.** Open Approvals. Inspect `save_brief`, its full content, stable action ID, and hash. Refresh. They remain unchanged. Approve it. Show that the worker continues, then pauses again for the separate page publication.
7. **Publish a proposed page.** Review and approve its exact content. Open the event page. Click Interested as a clearly labeled demonstration participant. No invitation is sent.
8. **Call the same version.** Open API. Show the published identifier. Run `npm run demo:api` with a scoped platform key. It returns 202 and a durable run ID. The same configuration runs from the API. Either finish its explicit prompts or open the same run in the dashboard.
9. **Show boundaries.** Start a second run and reject its save action. Its state becomes rejected and it has no artifact. Show the Usage chart and test-credit ledger. Explain that these credits are only a local run allowance; payments are deferred.

Close with the promise: **Configure an agent once. Call it from your app. See and control every action.**

Do not claim Cursor, Grok Bot, live sponsor APIs, Google Cloud hosting, a registered `.tech` domain, or a DEV publication unless you have the matching evidence in `docs/INTEGRATIONS.md` and `docs/BUILD.md`.
