# Sprite Agent Workbench

A local dashboard for anyone using [Sprites](https://sprites.dev/).

The goal is simple: if a Sprite is running, warm, cold, checkpointed, restored,
or idle, the dashboard should make that visible without making you dig through
terminal output.

## What works now

- Lists every Sprite visible to your authenticated Sprite account.
- Shows org-level running/warm/cold counts.
- Shows Sprite URL auth mode, last running time, and last warming time.
- Lists checkpoints for each Sprite.
- Explains cold/warm/running state with evidence-backed inference.
- Skips public health checks when a Sprite URL is auth gated.
- Supports hosted `SPRITES_API_TOKEN` mode with local Sprite CLI fallback.

RecallMEM on Sprite is the first real dogfood target, but the dashboard is not
hardcoded to RecallMEM. It should work for any Sprite your CLI can access.

See [docs/PLAN.md](docs/PLAN.md) for the full product plan, rollout path, and
optional Codex skill strategy.

See [docs/TODO.md](docs/TODO.md) for the current working task list.

See [docs/TESTING.md](docs/TESTING.md) for the test policy and user-runnable
checks.

See [docs/DEVLOG.md](docs/DEVLOG.md) for the project rationale, deployment
notes, and friction log.

## Run locally

For local development, install the Sprite CLI and log in first:

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

## Hosted mode

For a hosted deployment, set a server-only Sprites API token:

```bash
SPRITES_API_TOKEN="your-sprites-token"
```

The dashboard checks `SPRITES_API_TOKEN` first. If it exists, the app calls
`https://api.sprites.dev` directly from the server. If it is not set, the app
falls back to the local `sprite api ...` CLI.

Never use `NEXT_PUBLIC_` for this token. It should stay server-only.

## Test

Run the user-runnable checks before trusting a change:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## Why the dashboard still supports the CLI

The fastest local path for users is: if `sprite list` works in their terminal,
the dashboard can read the same authenticated account. Hosted mode exists for
deployments where the local CLI auth is not available.

## Next milestones

- Add per-Sprite detail pages.
- Add checkpoint create/restore controls.
- Store status history in Postgres instead of only rendering live API state.
- Add workbench-created agent runs with logs, diffs, tests, and labeled
  checkpoints.
- Add a RecallMEM example guide showing how to monitor a real app running on a
  Sprite.
