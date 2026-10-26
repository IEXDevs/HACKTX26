import { isTerminalStatus, type RunEvent } from "@agent-os/core";
import { NextRequest } from "next/server";
import { getRun, getRunEvents, requireWorkspace } from "@/lib/queries";
import { runBus } from "@/lib/runtime/emitter";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;

function frame(event: RunEvent): string {
  return `id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`;
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
  // EventSource sends the latest id on reconnect, even when the URL has an older cursor.
  const sinceRaw = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("since");
  const since = sinceRaw === null ? -1 : Number(sinceRaw);
  if (!Number.isSafeInteger(since) || since < -1 || sinceRaw?.trim() === "") {
    return Response.json({ error: "`since` must be an integer >= -1." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const run = await getRun(id);
  if (!run || run.workspaceId !== workspace.id) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSeq = since;
      let buffered = false;
      let polling = false;
      const backlog: RunEvent[] = [];

      const stop = (error?: unknown) => {
        if (closed) return;
        cleanup();
        try {
          if (error === undefined) controller.close();
          else controller.error(error);
        } catch {
          // The reader may have already cancelled the stream.
        }
      };

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };

      const close = (status: string) => {
        if (closed) return;
        write(`event: end\ndata: ${JSON.stringify({ kind: "end", status })}\n\n`);
        stop();
      };

      const deliver = (event: RunEvent) => {
        if (closed || event.seq <= lastSeq) return;
        // A local event may arrive before earlier events from another process.
        // Leave the cursor in place so the next database poll fills the gap.
        if (event.seq !== lastSeq + 1) return;
        lastSeq = event.seq;
        write(frame(event));
        if (event.payload.type === "run.completed") {
          close(event.payload.status);
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

      // The executor can be in another Cloud Run revision. The local bus is
      // only a fast path; persisted events remain the source of truth.
      const poll = setInterval(async () => {
        if (closed || !buffered || polling) return;
        polling = true;
        try {
          for (const event of await getRunEvents(id, lastSeq)) deliver(event);
          if (!closed) {
            const current = await getRun(id);
            if (current && isTerminalStatus(current.status)) close(current.status);
          }
        } catch (error) {
          stop(error);
        } finally {
          polling = false;
        }
      }, POLL_MS);

      const onAbort = () => stop();

      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        runBus().off(id, listener);
        request.signal.removeEventListener("abort", onAbort);
      };

      request.signal.addEventListener("abort", onAbort);
      runBus().on(id, listener);
      if (request.signal.aborted) {
        stop();
        return;
      }

      // Subscribe first, replay second: an event written between the two steps
      // lands in `backlog` instead of being lost.
      try {
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
      } catch (error) {
        stop(error);
      }
    },
    cancel() {
      cleanup();
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
