import { describe, expect, it } from "vitest";
import { dayStarts, sparkPoints, startOfLocalDay, summarizeRuns } from "./run-stats";

describe("summarizeRuns", () => {
  const noon = (daysAgo: number, hour = 12) => {
    const day = new Date("2026-10-25T12:00:00");
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, 0, 0, 0);
    return day;
  };

  it("splits the last seven local days and ignores older rows", () => {
    const now = noon(0).getTime();
    const stats = summarizeRuns(
      [
        { status: "succeeded", costUsd: 1, startedAt: noon(8) },
        { status: "succeeded", costUsd: 0.4, startedAt: noon(1) },
        { status: "failed", costUsd: 0.1, startedAt: noon(1) },
        { status: "failed", costUsd: 0.2, startedAt: noon(0) },
        { status: "awaiting_approval", costUsd: 0, startedAt: noon(0) },
        { status: "running", costUsd: 0.05, startedAt: noon(0) },
      ],
      now,
    );

    expect(stats.finished).toBe(3);
    expect(stats.successRate).toBeCloseTo(1 / 3);
    expect(stats.failed).toBe(2);
    expect(stats.waiting).toBe(1);
    expect(stats.spendToday).toBeCloseTo(0.25);
    expect(stats.series.success).toHaveLength(7);
    expect(stats.series.success.at(-1)).toBe(0);
    expect(stats.series.failed.at(-2)).toBe(1);
    expect(stats.series.waiting.at(-1)).toBe(1);
  });

  it("treats halted and cancelled as failed", () => {
    const now = noon(0).getTime();
    const stats = summarizeRuns(
      [
        { status: "halted", costUsd: 0.3, startedAt: noon(0) },
        { status: "cancelled", costUsd: 0.1, startedAt: noon(0) },
        { status: "succeeded", costUsd: 0.2, startedAt: noon(0) },
      ],
      now,
    );
    expect(stats.failed).toBe(2);
    expect(stats.successRate).toBeCloseTo(1 / 3);
  });
});

describe("dayStarts", () => {
  it("ends on today's local midnight", () => {
    const now = new Date("2026-10-25T18:40:00").getTime();
    const starts = dayStarts(now);
    expect(starts).toHaveLength(7);
    expect(starts.at(-1)).toBe(startOfLocalDay(now));
    expect(starts[1]! - starts[0]!).toBeGreaterThan(20 * 60 * 60 * 1000);
  });
});

describe("sparkPoints", () => {
  it("puts the peak at the top of the viewBox", () => {
    const points = sparkPoints([0, 2, 1], 80, 24);
    const ys = points.split(" ").map((pair) => Number(pair.split(",")[1]));
    expect(ys[1]).toBeLessThan(ys[0]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
  });
});
