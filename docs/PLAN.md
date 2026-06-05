# Sprite Agent Workbench Plan

Sprite Agent Workbench is a standalone dashboard for people building with
Sprites. The first dogfood target is RecallMEM running on a Sprite, but the
dashboard should stay generic enough for any Sprite user to clone, run, and
understand what is happening with their environments.

The product idea is simple:

> Sprites give agents a persistent computer. The workbench should show what
> happened inside that computer, why it is awake or asleep, and where it can be
> restored from.

## Distribution Strategy

This should be a repo first, with an optional Codex skill later.

The repo is the product:

```txt
sprite-agent-workbench/
  app/                  # dashboard UI
  lib/                  # Sprite CLI/API readers
  docs/                 # product plan, setup, architecture notes
  README.md             # normal user setup
```

Users clone the repo, run it locally, and point it at their existing Sprite
account through either `SPRITES_API_TOKEN` or the authenticated Sprite CLI.

The optional skill is an agent helper:

```txt
sprite-agent-workbench/
  skills/
    codex/
      SKILL.md
```

The skill should not be required to use the dashboard. It should help Codex or
similar coding agents operate more safely around Sprites: inspect status,
explain sleep, create clean checkpoints, restore when asked, and capture work
history.

Short version:

> If you use Sprites, run the dashboard. If you use Codex with Sprites, install
> the optional skill too.

## V1: Read-Only Sprite Dashboard

Goal: if `SPRITES_API_TOKEN` is set, hosted deployments work. If not, and
`sprite list` works in a user's terminal, local development works.

Data source:

- Prefer server-only `SPRITES_API_TOKEN`.
- Call `https://api.sprites.dev/v1/sprites` for visible Sprite state.
- Call `https://api.sprites.dev/v1/sprites/{name}/checkpoints` for checkpoint
  history.
- Fall back to the locally authenticated `sprite` CLI when no token is set.

Dashboard should show:

- All Sprites visible to the current account.
- Org-level running, warm, and cold counts.
- Per-Sprite status: `running`, `warm`, `cold`, or unknown.
- App URL and URL auth mode.
- Last running time and last warming time.
- Checkpoint history.
- A plain-English "why this state?" explanation with evidence.
- Health-check status, while skipping public checks for auth-gated URLs.

The first version is intentionally read-only. It should answer:

- What Sprites do I have?
- Which ones are warm, cold, or running?
- Why does this Sprite look asleep?
- What checkpoints can I restore from?

## V2: Per-Sprite Detail Pages

Add a detail page for each Sprite:

```txt
/sprites/[name]
```

The detail page should show:

- Current status and URL health.
- Checkpoint timeline.
- Last known activity.
- Recent workbench observations.
- Any detected warnings, like auth-gated URL, no app URL, failed health check,
  or checkpoint fetch errors.

This is where the app starts feeling like a real workbench instead of a card
grid.

## V3: Status History

Store observations in a small local database.

Possible storage:

- SQLite for easiest local setup.
- Postgres later if the dashboard itself is hosted.

Track:

- Sprite name.
- Observed status.
- Last running/warming timestamps.
- URL auth mode.
- Health check result.
- Checkpoint count.
- Fetched-at timestamp.

This enables:

- "This Sprite went cold at roughly 2:14 PM."
- "This has been warm for 18 minutes."
- "The app URL has failed health checks 4 times in a row."

V1 tells users what is happening now. V3 tells users what changed.

## V4: Checkpoint Actions

Add controlled actions:

- Create checkpoint.
- Add checkpoint comment.
- Restore checkpoint.
- Compare checkpoint metadata.

Important safety rule:

> Checkpoint creation and restore must be explicit user actions. The dashboard
> should never restore automatically.

For agent workflows, the clean-start checkpoint should be created after the repo
is cloned and dependencies are installed, but before the agent receives task
instructions. That way, undo returns to a useful ready-to-work state instead of
forcing setup to run again.

## V5: Agent Run Tracking

This is where the workbench becomes more than a Sprite dashboard.

Track workbench-created agent runs:

- Task prompt.
- Target Sprite.
- Starting checkpoint.
- End checkpoint.
- Commands executed.
- Files changed.
- Test results.
- Logs and errors.
- Final summary.

The dashboard should make agent work inspectable:

- What did the agent try?
- What failed?
- What changed?
- Which checkpoint can I restore?
- Did tests pass?

This is the bridge from "Sprite status dashboard" to "agent workbench."

## V6: Optional Codex Skill

The optional skill should teach Codex how to work with this dashboard and with
Sprites safely.

The skill should cover:

- How to inspect Sprite status.
- How to read checkpoint history.
- How to explain cold/warm/running state.
- How to create a clean-start checkpoint at the right time.
- How to run an agent task under constraints.
- How to avoid destructive restore operations unless the user explicitly asks.
- How to summarize a run into the dashboard's expected format.

Possible skill structure:

```txt
skills/codex/SKILL.md
skills/codex/templates/run-summary.md
skills/codex/templates/checkpoint-policy.md
```

The skill should not duplicate the dashboard. It should be a workflow layer on
top of it.

## V7: Hosted Hardening

Hosted token mode exists in V1:

- User provides a Sprite API token.
- Dashboard runs without requiring the local CLI.
- Token is stored only in environment variables or a secure secret store.

Future hosted hardening:

- Add an onboarding screen for missing/invalid hosted tokens.
- Support multiple orgs/accounts if the API exposes them.
- Add clearer deployment docs for running the workbench on a Sprite.

This matters if the dashboard itself is deployed on a Sprite, Fly Machine, or
another always-on app host.

## UX Principles

The dashboard should be obvious, not clever.

Good states:

- "Warm / recently touched"
- "Likely idle sleep"
- "Auth gated"
- "No response"
- "Checkpoint fetch failed"

Bad states:

- "Unknown error"
- "Something went wrong"
- "Cold" with no explanation

Every warning should answer:

- What happened?
- Why do we think that?
- What should the user do next?

## Non-Goals For Now

- Do not replace the official Sprites dashboard.
- Do not manage billing.
- Do not require GitHub connectors in V1.
- Do not run arbitrary agent commands in V1.
- Do not restore checkpoints automatically.
- Do not make RecallMEM a hardcoded special case.

## Current Status

The first read-only version exists:

- New Next.js app in `/Users/chrissean/Documents/demos/sprite-agent-workbench`.
- Reads hosted `SPRITES_API_TOKEN`, with authenticated Sprite CLI fallback.
- Lists Sprites.
- Shows status counts.
- Shows checkpoint history.
- Infers warm/cold/running explanations.
- Skips health checks for auth-gated URLs.

Next best step:

1. Add hosted setup docs.
2. Add per-Sprite detail pages.
3. Then add local status history.
4. Then add checkpoint actions.
5. Then add agent run tracking.
6. Then add the optional Codex skill.
