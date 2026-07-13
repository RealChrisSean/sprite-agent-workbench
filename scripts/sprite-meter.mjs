#!/usr/bin/env node
// The on-Sprite meter reader. It produces a counter-based local estimate, not
// invoice data. CPU/memory use cgroup values; optional `du` storage values are
// only directory-size proxies for scenario modeling.
//
// Environment:
//   WORKBENCH_URL      Workbench base URL (default: http://localhost:1340)
//   WORKBENCH_INGEST_TOKEN  Required app-level ingest secret
//   WORKBENCH_EDGE_TOKEN   Optional Sprite URL bearer token
//   SPRITE_NAME        Sprite these samples belong to (else read from ./.sprite)
//   METER_INTERVAL_MS  Sample interval (default: 60000)
//   METER_SOURCE       "cgroup" (default) or "synthetic" for local demo/testing
//   METER_HOT_DIR      Optional directory-size proxy
//   METER_COLD_DIR     Optional directory-size proxy
//
// Usage:
//   node scripts/sprite-meter.mjs                 # one real sample
//   node scripts/sprite-meter.mjs --continuous    # opt-in sampling loop
//
// On SIGINT/SIGTERM it takes one final sample (captures the tail CPU) and exits.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveSpriteName } from "./workbench-core.mjs";
import {
  DEFAULT_INTERVAL_MS,
  makeCgroupSampler,
  makeSyntheticSampler,
  postSample,
} from "./meter-core.mjs";

const execFileAsync = promisify(execFile);

/** Bytes consumed by a directory via `du -sb`. Returns 0 if it can't read. */
async function duBytes(dir) {
  if (!dir) return 0;
  try {
    const { stdout } = await execFileAsync("du", ["-sb", dir], {
      maxBuffer: 1024 * 1024,
    });
    return Number(stdout.split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

function buildSampler({ source, spriteName, hotDir, coldDir }) {
  if (source === "synthetic") {
    return makeSyntheticSampler({ spriteName });
  }
  return makeCgroupSampler({
    spriteName,
    hotStorageBytes: () => duBytes(hotDir),
    coldStorageBytes: () => duBytes(coldDir),
    storageMeasurement: hotDir || coldDir ? "directory-du" : "none",
  });
}

async function main() {
  const continuous = process.argv.includes("--continuous");
  const workbenchUrl =
    process.env.WORKBENCH_URL || "http://localhost:1340";
  const spriteName = resolveSpriteName();
  const ingestToken = process.env.WORKBENCH_INGEST_TOKEN?.trim();
  if (!ingestToken) {
    console.error("Error: WORKBENCH_INGEST_TOKEN is required.");
    process.exit(2);
  }
  if (!spriteName) {
    console.error(
      "Error: could not resolve a Sprite. Set SPRITE_NAME or add a .sprite file."
    );
    process.exit(2);
  }

  const source = process.env.METER_SOURCE === "synthetic" ? "synthetic" : "cgroup";
  const intervalMs = Number(process.env.METER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const sampler = buildSampler({
    source,
    spriteName,
    hotDir: process.env.METER_HOT_DIR || "",
    coldDir: process.env.METER_COLD_DIR || "",
  });

  let stopping = false;
  const tick = async (label = "sample") => {
    try {
      const sample = await sampler();
      await postSample({
        workbenchUrl,
        sample,
        ingestToken,
        edgeToken: process.env.WORKBENCH_EDGE_TOKEN?.trim(),
      });
      console.log(
        `[${sample.observedAt}] ${label}: cpu=${(sample.cpuUsageUsec / 1e6).toFixed(1)}s ` +
          `mem=${(sample.memCurrentBytes / 1024 ** 3).toFixed(2)}GiB ` +
          `hot=${(sample.storageHotBytes / 1024 ** 3).toFixed(2)}GiB`
      );
    } catch (err) {
      console.error(`Sample failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  await tick("initial");
  if (!continuous) return;

  console.log(
    `Metering ${spriteName} every ${intervalMs}ms via ${source} → ${workbenchUrl}`
  );
  console.warn(
    "Continuous metering is itself ongoing activity and can prevent this Sprite from becoming idle."
  );
  const timer = setInterval(tick, intervalMs);

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    console.log(`\n${signal} received — taking final sample (captures tail CPU).`);
    await tick("final");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
