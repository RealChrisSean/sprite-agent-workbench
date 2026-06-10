# Agent Runner Skill: Record Run Events in the Workbench

This is the instruction sheet for any coding agent (Codex, Claude Code, or a
custom runner) working on a repo that is hosted in or monitored by Sprite
Agent Workbench. Following it makes the agent's work show up in the
Workbench run timeline and checkpoint context automatically — no manual
seed events.

## What you record

| Moment                          | Command                                      |
| ------------------------------- | -------------------------------------------- |
| You start a task                | `start "<task title>"`                       |
| You finish editing files        | `files "<what changed and why>"`             |
| You create a checkpoint         | `event checkpoint_created "Checkpoint vN"`   |
| The task succeeds               | `complete "<task title>"`                    |
| The task fails or is abandoned  | `fail "<task title>" "<what went wrong>"`    |

## Setup (once per task)

```bash
export WORKBENCH_URL="http://localhost:3001"   # or the hosted Workbench URL
export SPRITE_NAME="recallmem"                 # the Sprite this work targets
```

## Flow

1. Announce the run and capture the returned run id:

   ```bash
   node scripts/record-run-event.mjs start "Fix login redirect bug"
   # prints: runId: run-20260610-...
   export RUN_ID="run-20260610-..."
   ```

2. After making changes, record the file footprint. The script reads
   `git diff --name-status` itself; you never paste file contents:

   ```bash
   node scripts/record-run-event.mjs files "Patched session cookie path"
   ```

   Use `--ref origin/main` to describe a whole branch instead of the
   working tree.

3. Close the run:

   ```bash
   node scripts/record-run-event.mjs complete "Fix login redirect bug"
   # or: node scripts/record-run-event.mjs fail "Fix login redirect bug" "tests failed"
   ```

## Rules

- Never put secrets, tokens, or env values in labels or summaries. The
  Workbench redacts secret-looking *paths* server-side, but free-text
  fields are stored as sent.
- Reuse `RUN_ID` for every event in one task so the timeline groups them.
- Recording events is best-effort: if the Workbench is unreachable, log it
  and continue the task. Never fail the user's work because telemetry
  failed.
- The events API only accepts same-origin requests; the script handles the
  Origin header for you. If you call the API directly, send
  `Origin: <workbench origin>` and `content-type: application/json`.

## Payload reference (for direct API calls)

`POST /api/runs/events`

```json
{
  "spriteName": "recallmem",
  "runId": "optional-grouping-key",
  "type": "run_started | run_completed | run_failed | command_started | command_finished | file_changed | checkpoint_created | restore_performed",
  "label": "short human title",
  "summary": "optional, max 500 chars",
  "files": [{ "path": "app/page.tsx", "status": "M" }],
  "diffStat": "4 files changed, 120 insertions(+)"
}
```

`files`/`diffStat` are only valid on `file_changed` events (max 200 files;
statuses A, M, D). Secret-like paths are redacted before storage but still
counted.
