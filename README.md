# Sprite Agent Workbench

A local dashboard for anyone using [Sprites](https://sprites.dev/).

The goal is simple: if a Sprite is running, warm, cold, checkpointed, restored,
or idle, the dashboard should make that visible without making you dig through
terminal output.

## What works now

- Lists every Sprite visible to your authenticated Sprite CLI.
- Shows org-level running/warm/cold counts.
- Shows Sprite URL auth mode, last running time, and last warming time.
- Lists checkpoints for each Sprite.
- Explains cold/warm/running state with evidence-backed inference.
- Skips public health checks when a Sprite URL is auth gated.

RecallMEM on Sprite is the first real dogfood target, but the dashboard is not
hardcoded to RecallMEM. It should work for any Sprite your CLI can access.

See [docs/PLAN.md](docs/PLAN.md) for the full product plan, rollout path, and
optional Codex skill strategy.

## Run locally

Install the Sprite CLI and log in first:

```bash
sprite login
sprite list
```

Then run the dashboard:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Why the dashboard uses the CLI first

The fastest path for users is: if `sprite list` works in their terminal, the
dashboard can read the same authenticated account. Later versions can add a
direct token-based API mode for hosted deployments.

## Next milestones

- Add per-Sprite detail pages.
- Add checkpoint create/restore controls.
- Store status history in Postgres instead of only rendering live API state.
- Add workbench-created agent runs with logs, diffs, tests, and labeled
  checkpoints.
- Add a RecallMEM example guide showing how to monitor a real app running on a
  Sprite.
