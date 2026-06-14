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

import {
  DEFAULT_WORKBENCH_URL,
  dispatchRecord,
  postEvent,
} from "./workbench-core.mjs";

const WORKBENCH_URL = process.env.WORKBENCH_URL || DEFAULT_WORKBENCH_URL;
const SPRITE_NAME = process.env.SPRITE_NAME || "";
const RUN_ID = process.env.RUN_ID || "";

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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();
  if (!SPRITE_NAME) usage("SPRITE_NAME is required.");

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
    workbenchUrl: WORKBENCH_URL,
    spriteName: SPRITE_NAME,
    runId: RUN_ID,
    payload: result.payload,
  });
  const runId = body.event?.runId || RUN_ID || "";
  console.log(`Recorded ${result.payload.type} for ${SPRITE_NAME}.`);
  if (runId) {
    console.log(`runId: ${runId}`);
    console.log(`(export RUN_ID=${runId} to group later events into this run)`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
