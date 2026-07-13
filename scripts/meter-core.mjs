// Pure helpers for the on-Sprite meter reader (sprite-meter.mjs). Parsing and
// sampler construction live here so they can be unit-tested without real cgroup
// files (which don't exist on macOS/CI). The bin stays a thin loop.

import { readFile } from "node:fs/promises";

export const DEFAULT_INTERVAL_MS = 60_000;
export const CGROUP_ROOT = "/sys/fs/cgroup";

/** Extract usage_usec (cumulative CPU microseconds) from cgroup v2 cpu.stat. */
export function parseCpuStatUsageUsec(text) {
  for (const line of String(text).split("\n")) {
    const match = line.match(/^usage_usec\s+(\d+)\s*$/);
    if (match) return Number(match[1]);
  }
  throw new Error("cpu.stat did not contain a usage_usec line.");
}

/** Parse a single-integer cgroup file (e.g. memory.current). "max" => 0. */
export function parseCgroupInteger(text) {
  const trimmed = String(text).trim();
  if (trimmed === "max" || trimmed === "") return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, got: ${trimmed}`);
  }
  return value;
}

/**
 * Real sampler: reads local cgroup counters. Optional storage callbacks are
 * directory-size proxies, not the platform hot-cache/object-storage meters.
 * @param {{ spriteName?: string, cgroupRoot?: string, hotStorageBytes?: () => Promise<number>, coldStorageBytes?: () => Promise<number>, storageMeasurement?: "none" | "directory-du", read?: typeof import("node:fs/promises").readFile }} [opts]
 */
export function makeCgroupSampler({
  spriteName,
  cgroupRoot = CGROUP_ROOT,
  hotStorageBytes = async () => 0,
  coldStorageBytes = async () => 0,
  storageMeasurement = "none",
  read = readFile,
} = {}) {
  return async function sample(now = new Date()) {
    const [cpuText, memText, hot, cold] = await Promise.all([
      read(`${cgroupRoot}/cpu.stat`, "utf8"),
      read(`${cgroupRoot}/memory.current`, "utf8"),
      hotStorageBytes(),
      coldStorageBytes(),
    ]);
    return {
      spriteName,
      observedAt: now.toISOString(),
      cpuUsageUsec: parseCpuStatUsageUsec(cpuText),
      memCurrentBytes: parseCgroupInteger(memText),
      storageHotBytes: Number(hot) || 0,
      storageColdBytes: Number(cold) || 0,
      source: "cgroup",
      storageMeasurement,
    };
  };
}

/**
 * Synthetic sampler for local testing/demo where there are no cgroup files
 * (macOS, CI). Models a workload: cumulative CPU advances by a per-tick
 * fraction of nCpus; memory wobbles around a baseline; storage grows slowly.
 */
export function makeSyntheticSampler({
  spriteName = "demo-sprite",
  nCpus = 2,
  avgCpuFraction = 0.3,
  memBaselineBytes = 1.5 * 1024 ** 3,
  hotBaselineBytes = 5 * 1024 ** 3,
  coldBaselineBytes = 10 * 1024 ** 3,
  random = Math.random,
} = {}) {
  let cpuUsageUsec = 0;
  let lastMs = null;
  return async function sample(now = new Date()) {
    const nowMs = now.getTime();
    if (lastMs !== null) {
      const dtSec = (nowMs - lastMs) / 1000;
      // Busy-ness jitters around the average; CPU is cumulative.
      const fraction = Math.max(0, avgCpuFraction + (random() - 0.5) * 0.2);
      cpuUsageUsec += dtSec * nCpus * fraction * 1_000_000;
    }
    lastMs = nowMs;
    const memJitter = 1 + (random() - 0.5) * 0.1;
    return {
      spriteName,
      observedAt: now.toISOString(),
      cpuUsageUsec: Math.round(cpuUsageUsec),
      memCurrentBytes: Math.round(memBaselineBytes * memJitter),
      storageHotBytes: Math.round(hotBaselineBytes),
      storageColdBytes: Math.round(coldBaselineBytes),
      source: "synthetic",
      storageMeasurement: "directory-du",
    };
  };
}

/** POST one sample to the Workbench ingest route. Impure. */
export async function postSample({
  workbenchUrl,
  sample,
  ingestToken,
  edgeToken = "",
  fetchImpl = fetch,
}) {
  if (!ingestToken) {
    throw new Error("WORKBENCH_INGEST_TOKEN is required.");
  }
  const url = new URL("/api/meter/samples", workbenchUrl);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workbench-ingest-token": ingestToken,
      ...(edgeToken ? { authorization: `Bearer ${edgeToken}` } : {}),
    },
    body: JSON.stringify(sample),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Workbench returned an unexpected redirect (${res.status}).`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `Workbench returned ${contentType || "a non-JSON response"}; refusing to treat it as ingest success.`
    );
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.message || `Workbench returned HTTP ${res.status}`);
  }
  if (body.ok !== true) {
    throw new Error("Workbench JSON response did not confirm ingest success.");
  }
  return body;
}
