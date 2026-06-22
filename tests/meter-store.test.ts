import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readMeterSamples,
  recordMeterSample,
  validateMeterSampleInput,
} from "../lib/meter-store";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function useSampleFile() {
  const dir = mkdtempSync(join(tmpdir(), "meter-"));
  tempDirs.push(dir);
  vi.stubEnv(
    "SPRITE_AGENT_WORKBENCH_METER_SAMPLES_PATH",
    join(dir, "meter-samples.jsonl")
  );
}

const valid = {
  spriteName: "demo",
  observedAt: "2026-06-20T00:00:00Z",
  cpuUsageUsec: 1000,
  memCurrentBytes: 2048,
  storageHotBytes: 4096,
  storageColdBytes: 8192,
  source: "cgroup",
};

describe("recordMeterSample / readMeterSamples", () => {
  it("round-trips a sample and filters by sprite", async () => {
    useSampleFile();
    await recordMeterSample(valid);
    await recordMeterSample({ ...valid, spriteName: "other", observedAt: "2026-06-20T00:01:00Z" });

    const all = await readMeterSamples();
    expect(all).toHaveLength(2);

    const demoOnly = await readMeterSamples("demo");
    expect(demoOnly).toHaveLength(1);
    expect(demoOnly[0]).toMatchObject({ spriteName: "demo", cpuUsageUsec: 1000 });
  });

  it("returns ascending by observedAt", async () => {
    useSampleFile();
    await recordMeterSample({ ...valid, observedAt: "2026-06-20T00:02:00Z", cpuUsageUsec: 3 });
    await recordMeterSample({ ...valid, observedAt: "2026-06-20T00:00:00Z", cpuUsageUsec: 1 });
    await recordMeterSample({ ...valid, observedAt: "2026-06-20T00:01:00Z", cpuUsageUsec: 2 });
    const samples = await readMeterSamples("demo");
    expect(samples.map((s) => s.cpuUsageUsec)).toEqual([1, 2, 3]);
  });

  it("returns [] when no file exists", async () => {
    useSampleFile();
    expect(await readMeterSamples()).toEqual([]);
  });
});

describe("validateMeterSampleInput", () => {
  it("defaults observedAt and source", () => {
    const now = new Date("2026-06-20T12:00:00Z");
    const out = validateMeterSampleInput(
      { spriteName: "demo", cpuUsageUsec: 0, memCurrentBytes: 0, storageHotBytes: 0, storageColdBytes: 0 },
      now
    );
    expect(out.observedAt).toBe(now.toISOString());
    expect(out.source).toBe("cgroup");
  });

  it("rejects negative counters", () => {
    expect(() => validateMeterSampleInput({ ...valid, cpuUsageUsec: -1 })).toThrow(/non-negative/);
  });

  it("rejects non-finite counters", () => {
    expect(() =>
      validateMeterSampleInput({ ...valid, memCurrentBytes: Number.POSITIVE_INFINITY })
    ).toThrow(/finite/);
  });

  it("rejects a bad sprite name", () => {
    expect(() => validateMeterSampleInput({ ...valid, spriteName: "../etc" })).toThrow();
  });
});
