import { isTerminalStatus, type RunEvent, type RunEventPayload } from "@agent-os/core";
import { NextRequest } from "next/server";
import { getRun, getRunEvents } from "@/lib/queries";
import { runBus } from "@/lib/runtime/emitter";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

function frame(event: RunEvent, includeId: boolean): string {
  const id = includeId ? `id: ${event.seq}\n` : "";
  return `${id}event: run-event\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Replays the hash-chained event log from `?since=<seq>` and then follows live
 * writes. The stream never invents events: everything it sends came out of the
 * database first, so a reconnect produces the same trace.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const sinceRaw = new URL(request.url).searchParams.get("since");
  const since = sinceRaw === null ? -1 : Number(sinceRaw);
  if (!Number.isFinite(since) || since < -1) {
    return Response.json({ error: "`since` must be an integer >= -1." }, { status: 400 });
  }

  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSeq = since;
      let buffered = false;
      const backlog: RunEvent[] = [];

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const close = (status: string) => {
        if (closed) return;
        write(`event: end\ndata: ${JSON.stringify({ kind: "end", status })}\n\n`);
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      const deliver = (event: RunEvent) => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        write(frame(event, true));
        if (event.payload.type === "run.completed") {
          const status = (event.payload as Extract<RunEventPayload, { type: "run.completed" }>)
            .status;
          close(status);
        }
      };

      const listener = (event: RunEvent) => {
        if (!buffered) {
          backlog.push(event);
          return;
        }
        deliver(event);
      };

      const heartbeat = setInterval(() => {
        write(`: keep-alive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        cleanup();
      };

      const cleanup = () => {
        clearInterval(heartbeat);
        runBus().off(id, listener);
        request.signal.removeEventListener("abort", onAbort);
      };

      request.signal.addEventListener("abort", onAbort);
      runBus().on(id, listener);

      // Subscribe first, replay second: an event written between the two steps
      // lands in `backlog` instead of being lost.
      const history = await getRunEvents(id, since);
      for (const event of history) deliver(event);

      buffered = true;
      for (const event of backlog.sort((a, b) => a.seq - b.seq)) deliver(event);
      backlog.length = 0;

      if (!closed) {
        if (isTerminalStatus(run.status)) {
          close(run.status);
        } else {
          write(
            `event: ready\ndata: ${JSON.stringify({ lastSeq, status: run.status })}\n\n`,
          );
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
