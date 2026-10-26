import { EventEmitter } from "node:events";
import { appendEvent, GENESIS_HASH, type RunEventPayload } from "@agent-os/core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runs/[id]/stream/route";
import { getRun, getRunEvents, requireWorkspace } from "../queries";
import { runBus } from "./emitter";

vi.mock("../queries", () => ({ getRun: vi.fn(), getRunEvents: vi.fn(), requireWorkspace: vi.fn() }));
vi.mock("./emitter", () => ({ runBus: vi.fn() }));

const runId = "run_stream";
const event = (seq: number, payload: RunEventPayload = { type: "log", level: "info", message: `Event ${seq}` }) =>
  appendEvent(runId, seq, "2026-10-24T12:00:00.000Z", payload, GENESIS_HASH);
const decoder = new TextDecoder();

function request(query = "", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return GET(new NextRequest(`http://localhost/api/runs/${runId}/stream${query}`, init), {
    params: Promise.resolve({ id: runId }),
  });
}

describe("run event stream", () => {
  let bus: EventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventEmitter();
    vi.mocked(runBus).mockReturnValue(bus);
    vi.mocked(requireWorkspace).mockResolvedValue({ id: "ws_stream" } as Awaited<ReturnType<typeof requireWorkspace>>);
    vi.mocked(getRun).mockResolvedValue({ status: "running", workspaceId: "ws_stream" } as NonNullable<Awaited<ReturnType<typeof getRun>>>);
    vi.mocked(getRunEvents).mockResolvedValue([]);
  });

  afterEach(() => {
    bus.removeAllListeners();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it.each(["1.5", "NaN", "-2", "9007199254740992", ""])("rejects an invalid cursor (%s)", async (cursor) => {
    expect((await request(`?since=${cursor}`)).status).toBe(400);
    expect(getRunEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the reconnect header ahead of the original URL cursor", async () => {
    const response = await request("?since=0", { headers: { "Last-Event-ID": "4" } });
    expect(getRunEvents).toHaveBeenCalledWith(runId, 4);
    await response.body!.cancel();
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stream a run from another workspace", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({ status: "running", workspaceId: "other_workspace" } as NonNullable<Awaited<ReturnType<typeof getRun>>>);
    expect((await request()).status).toBe(404);
    expect(getRunEvents).not.toHaveBeenCalled();
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns 404 for a missing run without opening a stream", async () => {
    vi.mocked(getRun).mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    expect(getRunEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("buffers live events during replay and delivers duplicates only once", async () => {
    vi.mocked(getRunEvents).mockImplementationOnce(async () => {
      bus.emit(runId, event(1));
      bus.emit(runId, event(2));
      return [event(0), event(1)];
    });
    const response = await request();
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("event: ready")) {
      text += decoder.decode((await reader.read()).value);
    }
    expect([...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))).toEqual([0, 1, 2]);
    await reader.cancel();
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes and releases resources when the request is aborted", async () => {
    const abort = new AbortController();
    const response = await request("", { signal: abort.signal });
    abort.abort();
    expect(await response.text()).toContain("event: ready");
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not subscribe an already aborted request", async () => {
    const response = await request("", { signal: AbortSignal.abort() });
    expect(await response.text()).toBe("");
    expect(getRunEvents).not.toHaveBeenCalled();
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases resources when replay fails", async () => {
    vi.mocked(getRunEvents).mockRejectedValueOnce(new Error("Replay failed"));
    const response = await request();
    await expect(response.text()).rejects.toThrow("Replay failed");
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends after the completion event and releases resources", async () => {
    const response = await request();
    bus.emit(runId, event(0, { type: "run.completed", status: "succeeded", totalCostUsd: 0, durationMs: 1 }));
    const text = await response.text();
    expect(text).toContain("event: run-event");
    expect(text).toContain('event: end\ndata: {"kind":"end","status":"succeeded"}');
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers committed events from another web process", async () => {
    const response = await request();
    vi.mocked(getRunEvents).mockResolvedValueOnce([
      event(0), event(1, { type: "run.completed", status: "succeeded", totalCostUsd: 0, durationMs: 1 }),
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    const text = await response.text();
    expect(text).toContain("id: 0");
    expect(text).toContain("id: 1");
    expect(text).toContain("event: end");
    expect(bus.listenerCount(runId)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fills a sequence gap before delivering a later local completion", async () => {
    const response = await request();
    const completed = event(1, { type: "run.completed", status: "succeeded", totalCostUsd: 0, durationMs: 1 });
    bus.emit(runId, completed);
    vi.mocked(getRunEvents).mockResolvedValueOnce([event(0), completed]);
    await vi.advanceTimersByTimeAsync(2000);
    const text = await response.text();
    expect([...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))).toEqual([0, 1]);
    expect(text).toContain("event: end");
    expect(vi.getTimerCount()).toBe(0);
  });
});
