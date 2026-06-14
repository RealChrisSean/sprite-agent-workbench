#!/usr/bin/env node
// The Workbench CLI. The headline command is `checkpoint`: it takes a Sprites
// snapshot AND auto-writes the dashboard description (files, intent,
// verification), so a normal `sprite checkpoint create` workflow stops
// producing context-less "mystery hash" checkpoints.
//
// Environment:
//   WORKBENCH_URL  Workbench base URL (default: http://localhost:3001)
//   SPRITE_NAME    Override the Sprite (else read from ./.sprite)
//   RUN_ID         Optional run grouping key (for record subcommands)
//
// Commands:
//   checkpoint [comment] [--sprite X] [--verify "cmd"] [--workbench-url U]
//       Snapshot via `sprite checkpoint create` and record linked context.
//   start | files | verify | complete | fail | event   (see record-run-event)
//
// Examples:
//   npx workbench checkpoint "before auth refactor"
//   npx workbench checkpoint "deps bump" --verify "npm test"

import { execFileSync } from "node:child_process";
import {
  DEFAULT_WORKBENCH_URL,
  buildCheckpointEventPayloads,
  changedFilesFromGit,
  dispatchRecord,
  extractFlag,
  lastCommitSubject,
  parseCheckpointId,
  postEvent,
  resolveSpriteName,
} from "./workbench-core.mjs";

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage: workbench <command> [...args]",
      "",
      "Commands:",
      "  checkpoint [comment] [--sprite X] [--verify \"cmd\"] [--workbench-url U]",
      "  start | files | verify | complete | fail | event   (run-event verbs)",
      "",
      "Env: WORKBENCH_URL, SPRITE_NAME (optional; else ./.sprite), RUN_ID",
    ].join("\n")
  );
  process.exit(2);
}

async function runCheckpoint(args) {
  const { value: spriteFlag, rest: afterSprite } = extractFlag(args, "--sprite");
  const { value: urlFlag, rest: afterUrl } = extractFlag(afterSprite, "--workbench-url");
  const { value: verifyCmd, rest: afterVerify } = extractFlag(afterUrl, "--verify");
  const comment = afterVerify.filter((a) => !a.startsWith("--"))[0];

  const workbenchUrl =
    urlFlag || process.env.WORKBENCH_URL || DEFAULT_WORKBENCH_URL;
  const spriteName = resolveSpriteName({ explicit: spriteFlag });
  if (!spriteName) {
    usage(
      "Could not resolve a Sprite. Pass --sprite, set SPRITE_NAME, or run inside a directory with a .sprite file."
    );
    return;
  }

  console.warn(
    "Note: a checkpoint snapshots the entire Sprite filesystem, including any " +
      "secret-bearing files (e.g. .env.local). Avoid checkpointing right after " +
      "writing secrets unless you mean to preserve them."
  );

  // Resolve intent first so the snapshot itself carries the comment too.
  const intent = comment || lastCommitSubject();

  // 1. The snapshot itself — Sprites does this; we just trigger it.
  const createArgs = ["checkpoint", "create", "-s", spriteName];
  if (intent) createArgs.push("--comment", intent);
  const output = execFileSync("sprite", createArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const checkpointId = parseCheckpointId(output);
  console.log(
    checkpointId
      ? `Created checkpoint ${checkpointId} on ${spriteName}.`
      : `Created checkpoint on ${spriteName}.`
  );

  // 2. Gather the rest of the context — best-effort; never undo the snapshot.
  let fileChange = null;
  try {
    fileChange = changedFilesFromGit("HEAD");
  } catch {
    // Not a git repo / git unavailable — skip files.
  }

  let verify;
  if (verifyCmd) {
    try {
      execFileSync(verifyCmd, { shell: true, stdio: "inherit" });
      verify = "pass";
    } catch {
      verify = "fail";
    }
  }

  // 3. Write the linked description. If this fails, the checkpoint still
  //    exists — warn and exit 0.
  try {
    const payloads = buildCheckpointEventPayloads({
      checkpointId,
      intent,
      fileChange,
      verify,
    });
    for (const payload of payloads) {
      await postEvent({ workbenchUrl, spriteName, payload });
    }
    console.log(
      `Recorded context for ${checkpointId || "checkpoint"} on the Workbench.`
    );
  } catch (err) {
    console.warn(
      `Checkpoint created, but recording context failed: ${
        err instanceof Error ? err.message : err
      }`
    );
  }
}

async function runRecordVerb(command, rest) {
  const spriteName = resolveSpriteName();
  if (!spriteName) {
    usage("Could not resolve a Sprite. Set SPRITE_NAME or add a .sprite file.");
    return;
  }
  const workbenchUrl = process.env.WORKBENCH_URL || DEFAULT_WORKBENCH_URL;

  let result;
  try {
    result = dispatchRecord(command, rest);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
    return;
  }
  if (result.skip) {
    console.log(result.skip);
    return;
  }
  const body = await postEvent({
    workbenchUrl,
    spriteName,
    runId: process.env.RUN_ID || "",
    payload: result.payload,
  });
  console.log(`Recorded ${result.payload.type} for ${spriteName}.`);
  const runId = body.event?.runId;
  if (runId) console.log(`runId: ${runId}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();

  if (command === "checkpoint") {
    await runCheckpoint(rest);
    return;
  }
  const recordVerbs = ["start", "files", "verify", "complete", "fail", "event"];
  if (recordVerbs.includes(command)) {
    await runRecordVerb(command, rest);
    return;
  }
  usage(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
