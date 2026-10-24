# Relay contributor instructions

Write 80% of the way to ASD-STE100. Use short sentences and active voice. Do not restrict vocabulary rigidly.

Preserve the separation between web/API, worker, and trusted MCP connectors. Label fixture data. Do not claim provider success without a successful live call. Published versions and approval content are immutable. Add regression tests for changes to authorization, approvals, credits, and recovery.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
