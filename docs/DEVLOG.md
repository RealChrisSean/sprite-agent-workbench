# Dev Log

## 2026-06-05

### Why This App Exists

Sprite Agent Workbench exists because Sprites give agents a persistent computer,
but users still need a clear way to understand what is happening inside that
computer.

The official dashboard is useful, but this project is focused on the builder
and agent workflow:

- Which Sprites exist?
- Which ones are running, warm, or cold?
- Why does a Sprite look asleep?
- What checkpoints exist?
- What can I restore from?
- What did an agent try?
- What failed?
- What changed?

The long-term idea is not just "status dashboard." It is a workbench for
persistent agent environments.

RecallMEM is the first dogfood app because it already ran into the real pain:
local dev worked, Sprite hosting worked, but cold starts, auth gates,
checkpoints, and "what state is this thing in?" were not obvious enough.

### Dev Log Rule

Update this file whenever work on Sprite Agent Workbench changes behavior,
deployment state, testing strategy, or reveals a new friction point.

Good dev log entries should capture:

- what changed,
- why it changed,
- what broke or surprised us,
- how we verified it,
- what remains blocked,
- and any important URLs, commands, or repo paths future us will need.

The point is not to write a perfect changelog. The point is to preserve the
scar tissue while it is still fresh.

### Reference Access Points

Sprite Agent Workbench:

- Local repo: `/Users/chrissean/Documents/demos/sprite-agent-workbench`
- GitHub repo: `https://github.com/RealChrisSean/sprite-agent-workbench`
- Local dev URL: `http://localhost:1340`
- Sprite name: `sprite-agent-workbench`
- Sprite URL: `https://sprite-agent-workbench-bsq7x.sprites.app`
- Hosted app path: `/home/sprite/app`
- Current hosted blocker: needs server-side `SPRITES_API_TOKEN` to show live
  Sprite data.

RecallMEM dogfood target:

- Local repo: `/Users/chrissean/Documents/demos/local-stack/recallmem`
- Sprite name: `recallmem`
- Sprite URL: `https://recallmem-bsq7x.sprites.app`
- Purpose in this project: first real app to monitor because it has the exact
  Sprite pain this workbench is meant to explain: cold starts, auth-gated URLs,
  checkpoint timelines, deployment state, and "why is this asleep?" questions.

### Agent Rules Added

Added explicit repo-local rules in `AGENTS.md` so future coding agents know the
working boundaries and cannot casually wander around the filesystem.

Important rules:

- Work only inside `/Users/chrissean/Documents/demos/sprite-agent-workbench`.
- Use `/Users/chrissean/Documents/demos/local-stack/recallmem` only as the
  allowed RecallMEM dogfood/reference workspace.
- Treat RecallMEM as read-only unless the user explicitly asks for RecallMEM
  edits.
- Never touch files outside those directories without explicit user approval.
- Never commit secrets, `.env*`, `.sprite`, local DB data, or Sprite auth tokens.
- Keep `SPRITES_API_TOKEN` server-only.
- Update this dev log whenever behavior, deployment state, tests, or friction
  changes.
- Add tests or documented manual checks for meaningful behavior changes.
- Avoid destructive Sprite commands unless the user explicitly asks.

### What We Built So Far

- Created a standalone Next.js app outside the RecallMEM repo.
- Created a private GitHub repo:
  `RealChrisSean/sprite-agent-workbench`.
- Created a Sprite:
  `sprite-agent-workbench`.
- Built a read-only dashboard that shows:
  - all visible Sprites,
  - running/warm/cold counts,
  - app URL and URL auth mode,
  - latest checkpoints,
  - health-check state,
  - evidence-backed warm/cold/running explanations.
- Added hosted `SPRITES_API_TOKEN` mode.
- Kept local CLI fallback for the simplest local development path.
- Added a user-runnable test suite with `npm test`.
- Added CI for lint, tests, typecheck, and build.
- Deployed the latest code to the `sprite-agent-workbench` Sprite.

### Current Deployment State

Local mode works:

```bash
npm run dev
# http://localhost:1340
```

Because the local machine has an authenticated Sprite CLI, the dashboard can
read live Sprite data through:

```bash
sprite api /v1/sprites/
```

Hosted Sprite mode runs, but live Sprite data is blocked until a real
`SPRITES_API_TOKEN` is configured in the hosted environment.

The hosted app currently renders the correct setup error:

```txt
Sprite data is not ready
Check `SPRITES_API_TOKEN` on the server.
```

That is expected. The Sprite itself does not inherit the developer machine's
local Sprite CLI auth.

### Friction Points

#### 1. Local Auth Does Not Transfer To The Sprite

Locally, `sprite api /v1/sprites/` works because the machine is authenticated
through the Sprite CLI.

Inside the hosted Sprite, this failed:

```txt
No organizations found in config. Checking Fly.io account...
No authentication found.
Run 'sprite login' first.
```

This is the big reason hosted token mode is necessary.

The app cannot assume that because the developer has `sprite login` locally,
the hosted Sprite can also call the Sprites API.

#### 2. The Sprite CLI Stores Local Tokens In The macOS Keyring

The local CLI reports:

```txt
Keyring usage: ENABLED
Tokens are stored in: System keyring (secure)
```

That is good for local security, but it means we cannot safely or cleanly copy
the token into the hosted Sprite.

The right fix is for the user to create/provide a real Sprites API token and
set it as `SPRITES_API_TOKEN` in the hosted environment.

#### 3. The API Endpoint Shape Is Slightly Fussy

This worked:

```bash
sprite api /v1/sprites/
```

This returned a redirect HTML body instead of JSON:

```bash
sprite api /v1/sprites
```

But checkpoint routes worked without the trailing slash:

```bash
sprite api /v1/sprites/recallmem/checkpoints
```

So the app now uses:

- `/v1/sprites/` for the Sprite list.
- `/v1/sprites/{name}/checkpoints` for checkpoints.

This is exactly the kind of boring integration detail that needs tests.

#### 4. A New Sprite Does Not Automatically Clone The Repo

Creating the Sprite gave us a clean remote home directory with Node and Git,
but not the local project files.

We deployed the app by streaming a tarball into:

```txt
/home/sprite/app
```

That worked, but it is not a polished deployment story yet. Future work should
make deployment repeatable and documented.

#### 5. Stopping The Old Server Needed Exact Process Handling

The first remote stop command used `pkill -f`, and the command exited with
`143`, likely because the pattern matched part of its own shell command.

The safer approach was:

1. Inspect the running process.
2. Kill the exact `next-server` PID.
3. Clean `/home/sprite/app`.
4. Copy, install, build, and restart.

This should become a deploy script later.

#### 6. macOS Tar Emits Extended Attribute Warnings

During file copy, tar printed warnings like:

```txt
Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'
```

The copy still succeeded. These are macOS extended attributes, not app files.
They are noisy but harmless.

#### 7. Tests Caught A Real Regression

When hosted token mode was first added, the local CLI fallback broke because
the Sprite list endpoint was called without the trailing slash.

The local smoke test caught this:

```txt
Sprite API returned no JSON: <a href="/v1/sprites/">Moved Permanently</a>.
```

The fix was to call:

```txt
/v1/sprites/
```

This is why the project now has a rule: every meaningful feature needs a test
or an explicit documented manual check.

### Checks Run

Local:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

Remote Sprite:

```bash
npm ci
npm run lint
npm test
npx tsc --noEmit
npm run build
```

Remote smoke:

```bash
curl -sS http://localhost:3000
```

Result:

- App starts successfully on the Sprite.
- The updated hosted-token error appears as expected.
- Live hosted data remains blocked until `SPRITES_API_TOKEN` is configured.

### Next

1. Create/provide a real Sprites API token.
2. Configure it as `SPRITES_API_TOKEN` in the hosted Sprite environment.
3. Restart the hosted app.
4. Verify the hosted dashboard shows live Sprite data.
5. Add per-Sprite detail pages at `/sprites/[name]`.
6. Add status history so the app can answer "when did this Sprite go cold?"
