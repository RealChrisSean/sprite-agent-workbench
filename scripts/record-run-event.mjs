#!/usr/bin/env node
// Records agent run events against a Sprite Agent Workbench instance so the
// run timeline fills itself instead of relying on the manual seed form.
//
// Environment:
//   WORKBENCH_URL  Workbench base URL (default: http://localhost:3001)
//   SPRITE_NAME    Sprite the events belong to (required)
//   RUN_ID         Optional. Reuse to group events into one run. The first
//                  call prints the runId the Workbench assigned; export it.
//
// Commands:
//   start <label> [summary]          Record run_started
//   files [summary] [--ref <ref>]    Record file_changed from `git diff
//                                    --name-status <ref>` (default: HEAD)
//   verify pass|fail [summary]       Record a verification result (passing
//                                    reads green, failing reads red)
//   complete <label> [summary]       Record run_completed
//   fail <label> [summary]           Record run_failed
//   event <type> <label> [summary]   Record any supported event type
//
// Global flag (any command):
//   --checkpoint <id>   Link the event to a checkpoint so it appears in that
//                       checkpoint's "Known context" on the Sprite page.
//
// Examples:
//   SPRITE_NAME=recallmem node scripts/record-run-event.mjs start "Fix login bug"
//   RUN_ID=run-2026... node scripts/record-run-event.mjs files "Applied fix"
//   RUN_ID=run-2026... node scripts/record-run-event.mjs verify pass "Smoke test green"
//   node scripts/record-run-event.mjs complete "Fix login bug" --checkpoint v12

import { execFileSync } from "node:child_process";

const WORKBENCH_URL = process.env.WORKBENCH_URL || "http://localhost:3001";
const SPRITE_NAME = process.env.SPRITE_NAME || "";
const RUN_ID = process.env.RUN_ID || "";
const MAX_FILES = 200;

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage: record-run-event.mjs <command> [...args] [--checkpoint <id>]",
      "",
      "Commands:",
      "  start <label> [summary]",
      "  files [summary] [--ref <ref>]",
      "  verify pass|fail [summary]",
      "  complete <label> [summary]",
      "  fail <label> [summary]",
      "  event <type> <label> [summary]",
      "",
      "Global flag: --checkpoint <id>  (link the event to a checkpoint)",
      "Env: WORKBENCH_URL, SPRITE_NAME (required), RUN_ID (optional)",
    ].join("\n")
  );
  process.exit(2);
}

async function postEvent(payload) {
  const url = new URL("/api/runs/events", WORKBENCH_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The Workbench only accepts same-origin writes.
      origin: url.origin,
    },
    body: JSON.stringify({
      spriteName: SPRITE_NAME,
      ...(RUN_ID ? { runId: RUN_ID } : {}),
      ...payload,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || `Workbench returned HTTP ${res.status}`);
  }
  return body;
}

function changedFilesFromGit(ref) {
  const nameStatus = execFileSync("git", ["diff", "--name-status", ref], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  const files = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [rawStatus, ...paths] = line.split("\t");
    const kind = rawStatus[0];
    if (kind === "A" || kind === "M" || kind === "D") {
      files.push({ status: kind, path: paths[0] });
    } else if (kind === "R" || kind === "C") {
      // Renames/copies arrive as "<status>\told\tnew". Record what the
      // Workbench schema understands: the old path left, the new arrived.
      if (kind === "R") files.push({ status: "D", path: paths[0] });
      files.push({ status: "A", path: paths[1] });
    }
    // Other statuses (T, U, X) are rare; skip rather than guess.
  }

  const statOutput = execFileSync("git", ["diff", "--stat", ref], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  const statLine = statOutput.trim().split("\n").pop() || "";
  return { files, diffStat: statLine.trim().slice(0, 160) || undefined };
}

function extractFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return { value: undefined, rest: args };
  const value = args[i + 1];
  const rest = args.filter((_, index) => index !== i && index !== i + 1);
  return { value, rest };
}

async function main() {
  const [command, ...rawRest] = process.argv.slice(2);
  if (!command) usage();
  if (!SPRITE_NAME) usage("SPRITE_NAME is required.");

  // --checkpoint applies to any command; strip it before reading positionals.
  const { value: checkpointId, rest } = extractFlag(rawRest, "--checkpoint");

  let payload;
  if (command === "start") {
    const [label, summary] = rest;
    if (!label) usage("start needs a label.");
    payload = { type: "run_started", label, summary, status: "info" };
  } else if (command === "complete") {
    const [label, summary] = rest;
    if (!label) usage("complete needs a label.");
    payload = { type: "run_completed", label, summary, status: "success" };
  } else if (command === "fail") {
    const [label, summary] = rest;
    if (!label) usage("fail needs a label.");
    payload = { type: "run_failed", label, summary, status: "error" };
  } else if (command === "verify") {
    const [verdict, summary] = rest;
    if (verdict !== "pass" && verdict !== "fail") {
      usage("verify needs 'pass' or 'fail'.");
    }
    const passing = verdict === "pass";
    payload = {
      type: "command_finished",
      label: passing ? "Verification: passing" : "Verification: failing",
      summary,
      status: passing ? "success" : "error",
      metadata: { source: "runner", verification: passing ? "pass" : "fail" },
    };
  } else if (command === "event") {
    const [type, label, summary] = rest;
    if (!type || !label) usage("event needs a type and a label.");
    payload = { type, label, summary };
  } else if (command === "files") {
    const { value: refValue, rest: positional } = extractFlag(rest, "--ref");
    const ref = refValue || "HEAD";
    const summary = positional[0];
    const { files, diffStat } = changedFilesFromGit(ref);
    if (files.length === 0) {
      console.log("No changed files detected; nothing recorded.");
      return;
    }
    const truncated = files.length > MAX_FILES;
    payload = {
      type: "file_changed",
      label: `${files.length} file${files.length === 1 ? "" : "s"} changed`,
      summary: truncated
        ? `${summary ? `${summary} ` : ""}(list truncated to first ${MAX_FILES} files)`.trim()
        : summary,
      files: files.slice(0, MAX_FILES),
      diffStat,
    };
  } else {
    usage(`Unknown command: ${command}`);
  }

  if (checkpointId) {
    payload.metadata = { ...(payload.metadata || {}), checkpoint_id: checkpointId };
  }

  const body = await postEvent(payload);
  const runId = body.event?.runId || RUN_ID || "";
  console.log(`Recorded ${payload.type} for ${SPRITE_NAME}.`);
  if (runId) {
    console.log(`runId: ${runId}`);
    console.log(`(export RUN_ID=${runId} to group later events into this run)`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
