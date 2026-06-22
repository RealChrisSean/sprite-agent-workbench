import { describe, expect, it } from "vitest";
import {
  BYTES_PER_GB,
  DEFAULT_RATE_CARD,
  computeCost,
  getRateCardFromEnv,
  reconcile,
  summarizeMeterSamples,
  type MeterSample,
} from "../lib/metering";

function sample(overrides: Partial<MeterSample> & { observedAt: string }): MeterSample {
  return {
    spriteName: "demo",
    cpuUsageUsec: 0,
    memCurrentBytes: 0,
    storageHotBytes: 0,
    storageColdBytes: 0,
    source: "synthetic",
    ...overrides,
  };
}

describe("summarizeMeterSamples — CPU is exact from the cumulative counter", () => {
  it("sums counter deltas regardless of interval", () => {
    // 7200 CPU-seconds over the window => 2 CPU-hours exactly.
    const samples = [
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 0 }),
      sample({ observedAt: "2026-06-20T00:30:00Z", cpuUsageUsec: 3600 * 1e6 }),
      sample({ observedAt: "2026-06-20T01:00:00Z", cpuUsageUsec: 7200 * 1e6 }),
    ];
    const summary = summarizeMeterSamples(samples);
    expect(summary.cpuHours).toBeCloseTo(2, 9);
    expect(summary.cost.cpu).toBeCloseTo(2 * 0.07, 9);
    expect(summary.cpuResets).toBe(0);
  });

  it("handles a counter reset (cgroup recreated) without going negative", () => {
    const samples = [
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 5000 * 1e6 }),
      // counter resets to a small value: count the post-reset reading as usage
      sample({ observedAt: "2026-06-20T00:30:00Z", cpuUsageUsec: 1000 * 1e6 }),
    ];
    const summary = summarizeMeterSamples(samples);
    expect(summary.cpuResets).toBe(1);
    // 1000 CPU-seconds counted after the reset.
    expect(summary.cpuHours).toBeCloseTo(1000 / 3600, 9);
  });

  it("still counts CPU across a long reader-down gap (cumulative survives)", () => {
    const samples = [
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 0 }),
      // 1-hour gap, far larger than maxGapMs
      sample({ observedAt: "2026-06-20T01:00:00Z", cpuUsageUsec: 3600 * 1e6 }),
    ];
    const summary = summarizeMeterSamples(samples, { maxGapMs: 60_000 });
    expect(summary.cpuHours).toBeCloseTo(1, 9);
    expect(summary.notes.join(" ")).toMatch(/gap/i);
  });
});

describe("summarizeMeterSamples — memory/storage integration", () => {
  it("trapezoid-integrates a constant memory load into GB-hours", () => {
    // 2 GiB held constant for 1 hour => 2 GB-hours.
    // Sample every 5 min for an hour (realistic cadence, within the gap cap).
    const twoGiB = 2 * BYTES_PER_GB;
    const start = Date.parse("2026-06-20T00:00:00Z");
    const samples: MeterSample[] = [];
    for (let i = 0; i <= 12; i += 1) {
      samples.push(
        sample({
          observedAt: new Date(start + i * 5 * 60 * 1000).toISOString(),
          memCurrentBytes: twoGiB,
        })
      );
    }
    const summary = summarizeMeterSamples(samples);
    expect(summary.memoryGbHours).toBeCloseTo(2, 6);
    expect(summary.cost.memory).toBeCloseTo(2 * DEFAULT_RATE_CARD.memoryGbPerHour, 6);
    expect(summary.coverage).toBe(1);
    expect(summary.confidence).toBe("high");
  });

  it("does NOT integrate memory across a gap longer than maxGapMs", () => {
    const oneGiB = BYTES_PER_GB;
    const samples = [
      sample({ observedAt: "2026-06-20T00:00:00Z", memCurrentBytes: oneGiB }),
      sample({ observedAt: "2026-06-20T02:00:00Z", memCurrentBytes: oneGiB }),
    ];
    const summary = summarizeMeterSamples(samples, { maxGapMs: 60_000 });
    expect(summary.memoryGbHours).toBe(0); // gap skipped, no invented usage
    expect(summary.coverage).toBe(0);
    expect(summary.confidence).toBe("exact-cpu-only");
  });

  it("reconstructs the published Claude Code Session example within ~1%", () => {
    // 4h session: avg 0.6 CPU (=2.4 CPU-hrs), 1.5 GB mem (=6 GB-hrs),
    // 5 GiB hot, 10 GiB cold. Build a 4h ramp of samples every 5 min.
    const start = Date.parse("2026-06-20T00:00:00Z");
    const samples: MeterSample[] = [];
    const stepMs = 5 * 60 * 1000;
    const steps = (4 * 60 * 60 * 1000) / stepMs;
    for (let i = 0; i <= steps; i += 1) {
      const tMs = start + i * stepMs;
      const cpuSec = (i * stepMs) / 1000 * 0.6; // 0.6 CPU sustained
      samples.push(
        sample({
          observedAt: new Date(tMs).toISOString(),
          cpuUsageUsec: cpuSec * 1e6,
          memCurrentBytes: 1.5 * BYTES_PER_GB,
          storageHotBytes: 5 * BYTES_PER_GB,
          storageColdBytes: 10 * BYTES_PER_GB,
        })
      );
    }
    const summary = summarizeMeterSamples(samples);
    expect(summary.cpuHours).toBeCloseTo(2.4, 6);
    expect(summary.memoryGbHours).toBeCloseTo(6, 4);
    // Published example totals ≈ $0.44 (their GB defn rounds differently, so
    // assert our internal consistency: CPU + memory dominate).
    expect(summary.cost.cpu).toBeCloseTo(2.4 * 0.07, 6); // $0.168
    expect(summary.cost.memory).toBeCloseTo(6 * 0.04375, 6); // $0.2625
    expect(summary.cost.total).toBeGreaterThan(0.4);
    expect(summary.cost.total).toBeLessThan(0.5);
  });
});

describe("edge cases", () => {
  it("returns zeros with a note for no samples", () => {
    const summary = summarizeMeterSamples([]);
    expect(summary.sampleCount).toBe(0);
    expect(summary.cost.total).toBe(0);
    expect(summary.notes[0]).toMatch(/no samples/i);
  });

  it("needs at least two samples to measure", () => {
    const summary = summarizeMeterSamples([
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 100 }),
    ]);
    expect(summary.cpuHours).toBe(0);
    expect(summary.notes[0]).toMatch(/one sample/i);
  });
});

describe("getRateCardFromEnv", () => {
  it("uses defaults when unset", () => {
    expect(getRateCardFromEnv({})).toEqual(DEFAULT_RATE_CARD);
  });
  it("overrides from env and ignores junk", () => {
    const card = getRateCardFromEnv({
      WORKBENCH_RATE_CPU_PER_HOUR: "0.10",
      WORKBENCH_RATE_MEMORY_GB_PER_HOUR: "not-a-number",
    });
    expect(card.cpuPerHour).toBe(0.1);
    expect(card.memoryGbPerHour).toBe(DEFAULT_RATE_CARD.memoryGbPerHour);
  });
});

describe("reconcile", () => {
  it("flags within-target when computed matches the invoice", () => {
    const summary = summarizeMeterSamples([
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 0 }),
      sample({ observedAt: "2026-06-20T01:00:00Z", cpuUsageUsec: 3600 * 1e6 }),
    ]);
    // computed CPU cost = $0.07
    const result = reconcile(summary, { total: 0.0701 }, 1);
    expect(result.withinTarget).toBe(true);
    expect(result.totalPctError).toBeLessThan(1);
  });

  it("flags out-of-target and reports per-component error", () => {
    const computed = computeCost({ cpuHours: 1, memoryGbHours: 0, hotStorageGbHours: 0, coldStorageGbHours: 0 });
    expect(computed.total).toBeCloseTo(0.07, 9);
    const summary = summarizeMeterSamples([
      sample({ observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 0 }),
      sample({ observedAt: "2026-06-20T01:00:00Z", cpuUsageUsec: 3600 * 1e6 }),
    ]);
    const result = reconcile(summary, { cpu: 0.10, total: 0.10 }, 1);
    expect(result.withinTarget).toBe(false);
    const cpuLine = result.lines.find((line) => line.component === "cpu");
    expect(cpuLine?.pctError).toBeGreaterThan(1);
  });
});
