// Shared helpers for the Workbench CLIs (workbench.mjs and the legacy
// record-run-event.mjs). Pure/testable functions live here so the imperative
// bins stay thin. Posting and git reads are the only impure helpers.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  process.loadEnvFile?.(".env.local");
} catch (err) {
  if (!err || typeof err !== "object" || err.code !== "ENOENT") throw err;
}

export const DEFAULT_WORKBENCH_URL = "http://localhost:1340";
export const MAX_FILES = 200;

/** Remove `--flag value` from args, returning the value and the rest. */
export function extractFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return { value: undefined, rest: args };
  const value = args[i + 1];
  const rest = args.filter((_, index) => index !== i && index !== i + 1);
  return { value, rest };
}

/**
 * Resolve the Sprite name with zero config: explicit flag, then SPRITE_NAME,
 * then the local `.sprite` context file ({ "sprite": "name" }). Returns null
 * if none resolves.
 * @param {{ explicit?: string, cwd?: string, env?: Record<string, string|undefined> }} [opts]
 * @returns {string|null}
 */
export function resolveSpriteName({ explicit, cwd = process.cwd(), env = process.env } = {}) {
  if (explicit) return explicit;
  if (env.SPRITE_NAME) return env.SPRITE_NAME;
  try {
    const raw = readFileSync(join(cwd, ".sprite"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.sprite === "string" && parsed.sprite.trim()) {
      return parsed.sprite.trim();
    }
  } catch {
    // No .sprite file or unreadable — fall through.
  }
  return null;
}

/** Pull the first `vN` checkpoint id out of CLI output. */
export function parseCheckpointId(text) {
  const match = String(text).match(/\b(v\d+)\b/i);
  return match ? match[1] : null;
}

/** Read changed files + diff stat from git (impure; shells out). */
export function changedFilesFromGit(ref = "HEAD") {
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
      // Renames/copies arrive as "<status>\told\tnew": old left, new arrived.
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

/** Latest commit subject, or null. Used as the default checkpoint intent. */
export function lastCommitSubject() {
  try {
    return execFileSync("git", ["log", "-1", "--pretty=%s"], {
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

/** POST an event to the Workbench ingestion sink (impure). */
export async function postEvent({
  workbenchUrl,
  spriteName,
  runId,
  payload,
  ingestToken = process.env.WORKBENCH_INGEST_TOKEN,
  edgeToken = process.env.WORKBENCH_EDGE_TOKEN,
}) {
  if (!ingestToken) throw new Error("WORKBENCH_INGEST_TOKEN is required.");
  const url = new URL("/api/runs/events", workbenchUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workbench-ingest-token": ingestToken,
      ...(edgeToken ? { authorization: `Bearer ${edgeToken}` } : {}),
    },
    body: JSON.stringify({
      spriteName,
      ...(runId ? { runId } : {}),
      ...payload,
    }),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Workbench returned an unexpected redirect (${res.status}).`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Workbench returned a non-JSON response.");
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.message || `Workbench returned HTTP ${res.status}`);
  }
  if (body.ok !== true) {
    throw new Error("Workbench JSON response did not confirm success.");
  }
  return body;
}

/**
 * Build the event payload for a `record` subcommand (start/complete/fail/
 * verify/event/files). Pure except `files`, which reads git.
 * @returns {{ payload?: any, skip?: string }}
 */
export function dispatchRecord(command, args) {
  const { value: checkpointId, rest } = extractFlag(args, "--checkpoint");
  const withCheckpoint = (payload) =>
    checkpointId
      ? {
          payload: {
            ...payload,
            metadata: { ...(payload.metadata || {}), checkpoint_id: checkpointId },
          },
        }
      : { payload };

  if (command === "start") {
    const [label, summary] = rest;
    if (!label) throw new Error("start needs a label.");
    return withCheckpoint({ type: "run_started", label, summary, status: "info" });
  }
  if (command === "complete") {
    const [label, summary] = rest;
    if (!label) throw new Error("complete needs a label.");
    return withCheckpoint({ type: "run_completed", label, summary, status: "success" });
  }
  if (command === "fail") {
    const [label, summary] = rest;
    if (!label) throw new Error("fail needs a label.");
    return withCheckpoint({ type: "run_failed", label, summary, status: "error" });
  }
  if (command === "verify") {
    const [verdict, summary] = rest;
    if (verdict !== "pass" && verdict !== "fail") {
      throw new Error("verify needs 'pass' or 'fail'.");
    }
    return withCheckpoint(buildVerifyPayload(verdict === "pass", summary));
  }
  if (command === "event") {
    const [type, label, summary] = rest;
    if (!type || !label) throw new Error("event needs a type and a label.");
    return withCheckpoint({ type, label, summary });
  }
  if (command === "files") {
    const { value: refValue, rest: positional } = extractFlag(rest, "--ref");
    const summary = positional[0];
    const { files, diffStat } = changedFilesFromGit(refValue || "HEAD");
    if (files.length === 0) {
      return { skip: "No changed files detected; nothing recorded." };
    }
    return withCheckpoint(buildFileChangedPayload(files, diffStat, summary));
  }
  throw new Error(`Unknown command: ${command}`);
}

export function buildVerifyPayload(passing, summary) {
  return {
    type: "command_finished",
    label: passing ? "Verification: passing" : "Verification: failing",
    summary: summary ?? null,
    status: passing ? "success" : "error",
    metadata: { source: "runner", verification: passing ? "pass" : "fail" },
  };
}

export function buildFileChangedPayload(files, diffStat, summary) {
  const truncated = files.length > MAX_FILES;
  return {
    type: "file_changed",
    label: `${files.length} file${files.length === 1 ? "" : "s"} changed`,
    summary: truncated
      ? `${summary ? `${summary} ` : ""}(list truncated to first ${MAX_FILES} files)`.trim()
      : (summary ?? null),
    files: files.slice(0, MAX_FILES),
    diffStat,
  };
}

/**
 * Build the linked events for `workbench checkpoint`. Pure — the caller posts
 * them. Every payload carries metadata.checkpoint_id so they land in the
 * checkpoint's "Known context".
 * @param {{ checkpointId?: string|null, intent?: string|null, fileChange?: { files: Array<{ path: string, status: string }>, diffStat?: string }|null, verify?: string|null }} [opts]
 * @returns {any[]}
 */
export function buildCheckpointEventPayloads({
  checkpointId = null,
  intent = null,
  fileChange = null,
  verify = null,
} = {}) {
  const payloads = [];

  payloads.push({
    type: "checkpoint_created",
    label: checkpointId ? `Checkpoint ${checkpointId} created` : "Checkpoint created",
    summary: intent || "Created via workbench checkpoint.",
    status: "success",
    metadata: {
      checkpoint_id: checkpointId || "unknown",
      source: "workbench-cli",
      has_comment: Boolean(intent),
    },
  });

  if (fileChange && fileChange.files.length > 0) {
    const filePayload = buildFileChangedPayload(
      fileChange.files,
      fileChange.diffStat,
      null
    );
    filePayload.metadata = { checkpoint_id: checkpointId || "unknown", source: "workbench-cli" };
    payloads.push(filePayload);
  }

  if (verify === "pass" || verify === "fail") {
    const verifyPayload = buildVerifyPayload(verify === "pass", null);
    verifyPayload.metadata = {
      source: "workbench-cli",
      verification: verify,
      checkpoint_id: checkpointId || "unknown",
    };
    payloads.push(verifyPayload);
  }

  return payloads;
}
