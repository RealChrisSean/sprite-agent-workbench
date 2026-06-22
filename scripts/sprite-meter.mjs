#!/usr/bin/env node
// The on-Sprite meter reader. Runs INSIDE a Sprite and samples the same
// counters the platform bills from, then POSTs them to the Workbench. This is
// the "accurate tier": CPU is read from the cumulative cgroup counter so it is
// exact regardless of interval; memory/storage are sampled for integration.
//
// Environment:
//   WORKBENCH_URL      Workbench base URL (default: http://localhost:3001)
//   SPRITE_NAME        Sprite these samples belong to (else read from ./.sprite)
//   METER_INTERVAL_MS  Sample interval (default: 60000)
//   METER_SOURCE       "cgroup" (default) or "synthetic" for local demo/testing
//   METER_HOT_DIR      Dir measured as hot storage (default: /home/sprite/app)
//   METER_COLD_DIR     Dir measured as cold storage (optional)
//
// Usage:
//   node scripts/sprite-meter.mjs                 # real cgroup reader
//   METER_SOURCE=synthetic node scripts/sprite-meter.mjs --once   # demo
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
  });
}

async function main() {
  const once = process.argv.includes("--once");
  const workbenchUrl =
    process.env.WORKBENCH_URL || "http://localhost:3001";
  const spriteName = resolveSpriteName();
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
    hotDir: process.env.METER_HOT_DIR || "/home/sprite/app",
    coldDir: process.env.METER_COLD_DIR || "",
  });

  let stopping = false;
  const tick = async (label = "sample") => {
    try {
      const sample = await sampler();
      await postSample({ workbenchUrl, sample });
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
  if (once) return;

  console.log(
    `Metering ${spriteName} every ${intervalMs}ms via ${source} → ${workbenchUrl}`
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
