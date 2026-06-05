<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sprite Agent Workbench Agent Rules

These rules are mandatory for any coding agent working in this repository.

## Hard Workspace Boundary

- Primary workspace: `/Users/chrissean/Documents/demos/sprite-agent-workbench`.
- Allowed reference/dogfood workspace: `/Users/chrissean/Documents/demos/local-stack/recallmem`.
- Never read, edit, delete, stage, commit, push, or deploy files outside those two directories unless the user explicitly asks for that exact path.
- Treat RecallMEM as a dogfood target and reference app by default. Do not change RecallMEM files unless the user explicitly asks for RecallMEM edits.
- Never stage or commit RecallMEM changes while working on Sprite Agent Workbench unless the user explicitly asks for a cross-repo change.

## Why This App Exists

Sprite Agent Workbench exists because Sprites give agents a persistent computer, but users still need a clear way to see what happened, why a Sprite is warm/cold/running, and which checkpoints or runs matter.

RecallMEM is the first dogfood target, not a dependency to modify casually.

Reference points:

- Workbench local repo: `/Users/chrissean/Documents/demos/sprite-agent-workbench`
- Workbench Sprite: `sprite-agent-workbench`
- Workbench URL: `https://sprite-agent-workbench-bsq7x.sprites.app`
- RecallMEM local repo: `/Users/chrissean/Documents/demos/local-stack/recallmem`
- RecallMEM Sprite: `recallmem`
- RecallMEM URL: `https://recallmem-bsq7x.sprites.app`

## Secrets And Data

- Never commit secrets, API keys, local databases, `.env*` files, `.sprite`, keychain data, or Sprite auth tokens.
- `.env.example` is allowed because it contains placeholders only.
- `SPRITES_API_TOKEN` must stay server-only. Never expose it with `NEXT_PUBLIC_`.
- Do not copy local Sprite CLI auth from the macOS keyring into a Sprite or into the repo.
- If hosted live data needs auth, tell the user to create/provide a real Sprites API token and set `SPRITES_API_TOKEN` server-side.

## Dev Log Requirement

Update `docs/DEVLOG.md` whenever work changes behavior, deployment state, testing strategy, or reveals a new friction point.

Good entries should include:

- what changed,
- why it changed,
- what broke or surprised us,
- how it was verified,
- what remains blocked,
- and important URLs, commands, checkpoints, or repo paths.

## Testing Requirement

Every meaningful behavior change needs a user-runnable test or a documented manual check.

Preferred check suite:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

For docs-only changes, run at least:

```bash
npm run lint
npm test
```

## Git Rules

- Use explicit staging. Do not use broad staging when unrelated files may exist.
- Keep commits focused and named plainly.
- Before committing, inspect `git status --short --branch`.
- Do not push or deploy accidental local-only files such as `.sprite`.

## Sprite Safety Rules

- Do not run `sprite destroy`, `sprite restore`, or destructive remote commands without explicit user approval.
- Before changing a running Sprite, inspect the current process state.
- Prefer exact PIDs over broad `pkill -f` patterns when stopping remote processes.
- After a meaningful Sprite deploy, run checks and create a checkpoint with a useful comment.
- Remember that a newly created Sprite does not automatically clone this repo.
- Remember that hosted Sprites do not inherit local Sprite CLI auth.
