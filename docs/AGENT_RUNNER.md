# Agent Runner Skill: Record Run Events in the Workbench

This is the instruction sheet for any coding agent (Codex, Claude Code, or a
custom runner) working on a repo that is hosted in or monitored by Sprite
Agent Workbench. Following it makes the agent's work show up in the
Workbench run timeline and checkpoint context automatically — no manual
seed events.

## Checkpointing (the one command to remember)

To create a checkpoint, run (from the repo root):

```bash
node scripts/workbench.mjs checkpoint "<what you just did>"   # add --verify "npm test"
```

After a one-time `npm link` you can use `workbench checkpoint "..."` from
anywhere. This takes the Sprites snapshot **and** auto-writes the dashboard
context (changed files via `git diff`, the intent, and a verification result),
all linked to the new checkpoint. Do not use bare `sprite checkpoint create`
(contextless checkpoint ID), and do not use `npx workbench` (an unrelated
`workbench` package exists on npm). The Sprite is resolved from the local `.sprite` file
(override with `--sprite`).

### Optional: fire it automatically with a Claude Code hook

If you'd rather not remember the command, add a Stop hook in
`.claude/settings.json` so a checkpoint is taken at the end of each turn:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node scripts/workbench.mjs checkpoint \"end of turn\"" }
        ]
      }
    ]
  }
}
```

Other agents (Codex, Cursor) read their own instruction files; the rule in
`AGENTS.md` tells them to prefer `workbench checkpoint`.

## What you record

| Moment                          | Command                                      |
| ------------------------------- | -------------------------------------------- |
| You start a task                | `start "<task title>"`                       |
| You finish editing files        | `files "<what changed and why>"`             |
| A check passes or fails         | `verify pass\|fail "<what was checked>"`     |
| You create a checkpoint         | `event checkpoint_created "Checkpoint vN"`   |
| The task succeeds               | `complete "<task title>"`                    |
| The task fails or is abandoned  | `fail "<task title>" "<what went wrong>"`    |

Add `--checkpoint <id>` to any command to link the event to a checkpoint so it
appears in that checkpoint's "Known context" on the Sprite page. `verify pass`
reads green and `verify fail` reads red wherever it renders.

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

3. Record verification (smoke test, health check, type check — whatever the
   project uses to know it's alive). Link it to the checkpoint you just made
   so the checkpoint's context shows it:

   ```bash
   node scripts/record-run-event.mjs verify pass "Smoke test green" --checkpoint v12
   # or: node scripts/record-run-event.mjs verify fail "Type check failed"
   ```

4. Close the run:

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
