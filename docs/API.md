# Relay API v1

Base URL: `http://127.0.0.1:3000` locally; your HTTPS `.tech` domain in deployment.

Use `Authorization: Bearer <platform-key>`. A key belongs to one workspace. It cannot select another workspace through a header or body field. Dashboard sessions use a signed, HTTP-only cookie and same-origin mutation checks. Provider keys and the internal connector secret cannot authenticate to the native API.

## Runs

### POST /v1/runs

Required scope: `runs:write`. Required header: `Idempotency-Key`, 1–200 characters.

```json
{
  "versionId": "ver_community_1",
  "input": {
    "brief": "Welcoming meetup near UT Austin for 80 people, $3,000 budget",
    "fileId": "optional-private-upload-id"
  }
}
```

```json
{ "id": "run_…", "replayed": false, "status": "accepted", "url": "/v1/runs/run_…" }
```

Returns **202**. Optional `mode` must match the server configuration. Duplicate keys with the same request return the same run. Different content returns **409**. The accepted run reserves one test credit in the same transaction. Failed, rejected, and cancelled runs retain that reservation. There is no automatic refund policy in this prototype.

### GET /v1/runs/:id

Required scope: `runs:read`. Returns version, status, redacted input, requirements, observed steps, ordered events, evidence, output, approvals, and artifact records. Internal leases and model conversation checkpoints are omitted. Retrieval in a different workspace returns **404**.

States: `queued`, `running`, `awaiting_requirements`, `awaiting_approval`, `succeeded`, `failed`, `rejected`, `cancelled`.

### POST /v1/runs/:id/requirements

Required scope: `runs:write`. Available only in `awaiting_requirements`. Submit the full corrected requirements:

```json
{
  "title": "Community meetup",
  "location": "UT Austin, Austin, Texas",
  "attendees": 80,
  "budget": 3000,
  "currency": "USD",
  "date": null,
  "preferences": ["Vegetarian food", "Step-free access", "Quiet area"],
  "unknowns": ["Date", "All-in quotes", "Capacity", "Availability"]
}
```

The worker performs no research until this review is submitted. A second submission after the transition returns **409**.

### GET /v1/runs/:id/events

Required scope: `runs:read`. Returns `{ "data": [...] }` ordered by numeric event ID. `?after=123` returns only later events. IDs are globally increasing; they need not be contiguous within a run.

For SSE, add `?stream=true`. Reconnect with `Last-Event-ID: 123`, or `?stream=true&after=123`. Events use:

```text
id: 124
event: execution
data: {"id":"124","kind":"step.completed","step_id":"tool_0","data":{…}}
```

Keepalive comments maintain the connection. Terminal runs emit `event: done`, then close. The browser uses EventSource plus a state refresh fallback. Step events are observations and brief summaries. They do not include private model chain-of-thought.

### POST /v1/runs/:id/approvals/:actionId

Required scope: `approvals:write`. Submit the hash shown beside the full action content:

```json
{ "decision": "approve", "contentHash": "64-character-sha256-from-pending-action" }
```

Use `"reject"` to prevent the action. Approval applies to that action identifier and exact immutable content. `save_brief` and `publish_page` require separate decisions. Repeating the same decision succeeds with `replayed:true`. A conflicting decision or content hash returns **409**. Expired approvals return **410** when first decided; the worker also expires them proactively.

### POST /v1/runs/:id/cancel

Required scope: `runs:write`. Stops pending work and rejects pending approvals. Cancellation does not roll back a write that already completed. A trusted artifact write holds the run row lock; cancellation serializes after that operation if it has already started.

### GET /v1/artifacts/:actionId

Required scope: `agents:read` in this prototype. Returns the workspace-owned approved JSON through the trusted connector. It does not expose a public GCS object URL.

## Read-only completion subset

### POST /v1/chat/completions

Required scope: `runs:write`, plus an idempotency key. `model` is a **published Relay version identifier**, such as `ver_research_1`, with `readOnly:true`.

```json
{
  "model": "ver_research_1",
  "messages": [{ "role": "user", "content": "Give me a short checklist for a welcoming meetup." }],
  "stream": false
}
```

Returns the conventional `chat.completion` envelope with one assistant text message. Supported fields are exactly `model`, `messages`, and optional `stream:false`. Messages accept `user` and `assistant` text roles. Unknown fields, streaming, tool declarations, and multimodal messages return **400**. This subset executes a single text model call using the saved instructions. It does not call research tools or create write approvals. The worker still persists its execution events separately. It does not expose those events in the completion response.

The wait limit is 25 seconds. A timeout returns **504** with the durable run ID. Retrieve it through the runs API. Use the native API for event planning, tools, requirements review, and approvals. No universal OpenAI client or IDE compatibility is claimed.

## MCP delegation

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/Relay/services/delegation.ts"],
      "env": { "RELAY_API_KEY": "your-scoped-platform-key", "APP_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

Run the command from the Relay checkout, or use the absolute path to its `tsx` loader. Exposed tools:

| Tool              | Input                                  | Behavior                                                     |
| ----------------- | -------------------------------------- | ------------------------------------------------------------ |
| `start_agent_run` | `versionId`, `brief`, `idempotencyKey` | Calls native POST /v1/runs                                   |
| `get_agent_run`   | `runId`                                | Retrieves persisted observations and pending human decisions |

The delegation server does not expose an approval tool. A human can inspect and decide in the dashboard or an explicitly authorized native API client. The private connector service has a different secret and remains unreachable from the public reverse proxy.

## Devnet credits

`POST /v1/credits/invoices` with `{"payer":"public-key"}` requires `credits:write`. It returns the devnet recipient, amount, expiry, and exact `relay:<invoice>:<workspace>` memo. A user signs the transfer in their own devnet wallet. Relay holds no wallet secret.

`POST /v1/credits/verify` with `{"invoiceId":"…","signature":"…"}` requires the same scope. The server checks genesis hash, a finalized successful transaction, signer, destination, exact lamports, memo, invoice window, and workspace. An invoice or signature can credit once. All balances are test credits with no monetary value.
