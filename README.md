# Sprite Agent Workbench

<img width="1474" height="846" alt="Sprite Agent Workbench dashboard showing Sprite fleet state" src="https://github.com/user-attachments/assets/335ef865-ee2c-467f-b3b5-d1e213832bad" />

Sprite Agent Workbench is a visual dashboard for building with [Sprites](https://sprites.dev).

I built it because Sprites make agent work persistent, and persistent state gets hard to track fast. Once an agent can keep files, expose URLs, sleep, wake, and checkpoint itself, I want to see what it is doing without digging through commands every time.

This does not replace the Sprites dashboard or the Sprite CLI. It is the workbench I wanted open while building: fleet state, warm/cold signals, URL auth, and checkpoints in one place.

## Who This Is For

Use this if you are building with Sprites and keep asking:

- Which Sprite is running?
- Which one is asleep?
- Which one woke up recently?
- Which Sprite has a public URL?
- Which checkpoint should I trust?
- Which one was my agent using?

The terminal is still useful. This is for the moments where seeing the state is faster than remembering the exact command.

## What It Shows

<img width="1352" height="366" alt="Sprite Agent Workbench fleet view showing warm, cold, running, and unknown Sprite lanes" src="https://github.com/user-attachments/assets/a96400f7-d704-4026-bdec-b3a70d15fcde" />

The fleet view shows every Sprite visible to the configured account, grouped by running, warm, cold, and unknown state. It also shows why the app thinks a Sprite is warm or cold, which URL auth mode it uses, and when it was last running or warming.

The selected Sprite view focuses on checkpoints. It shows the checkpoint timeline, timestamps, context, and the state you would use for a future `revert to this` action.

## Keep The Token Out Of The Browser

The Sprites API token is the one part I do not want to get cute with. The browser should never receive the raw token. Not through `localStorage`, not through cookies, not through a URL, and not through anything prefixed with `NEXT_PUBLIC_`.

The dashboard needs access to Sprites, but that access belongs on the server side. The app supports a few ways to do that. The cleaner paths are listed first.

Auth source priority:

1. `SPRITES_API_GATEWAY_BASE_URL`
2. `SPRITES_API_TOKEN`
3. saved fallback token file
4. local `sprite` CLI

The app stops at the first one it can use.

<details>
<summary><b>Recommended Path: Use A Sprites Connector</b></summary>

I’d use a Sprites Connector when you can.

A connector keeps the raw Sprites API token out of the app. The credential lives in your Sprites organization, and the dashboard talks through the gateway instead of holding the token directly.

Set up a Custom API connector:

1. Open your Sprites organization.
2. Go to Connectors.
3. Add a Custom API connector.
4. Set the base URL to `https://api.sprites.dev`.
5. Store your Sprites API token in the connector.
6. Grant access only to the Sprite running this dashboard.
7. Copy the connector gateway base URL.
8. Set it as a server-only env var:

```bash
SPRITES_API_GATEWAY_BASE_URL=https://api.sprites.dev/v1/gateway/custom_api/CONNECTION_ID
```

The app appends Sprites API paths to that gateway URL:

```txt
/v1/sprites/
/v1/sprites/<name>/checkpoints
```

This is the path I’d rather use in production. If you rotate the credential, you rotate it in the connector. You do not have to go update every app environment that ever touched the token.

Docs: [Sprites Connectors](https://docs.sprites.dev/concepts/connectors/)

</details>

<details>
<summary><b>Simple Path: Use A Server Env Token</b></summary>

For a self-hosted dashboard, a server env token is simpler and still reasonable.

```bash
SPRITES_API_TOKEN=your-server-only-token
```

The browser still never receives the token. The server uses it to call the Sprites API.

The tradeoff is that the Sprite process now holds a long-lived token. That is not as clean as a connector, but it is still much better than putting the token in frontend code.

</details>

<details>
<summary><b>Fallback Path: Paste The Token Once</b></summary>

The dashboard includes a token paste flow because setup friction is real. I do not want someone blocked before they even see the app.

But again, this is still the fallback path. When you paste a token into the dashboard, the browser sends it once to `/api/setup/token`. The server validates it against the Sprites API, writes it outside the repo, creates the file with `600` permissions, and never returns the token to the browser.

Default path:

```txt
~/.sprite-agent-workbench/secrets.json
```

Override path:

```bash
SPRITE_AGENT_WORKBENCH_SECRET_PATH=/home/sprite/.sprite-agent-workbench/secrets.json
```

The thing to remember is checkpoints.

Sprites can checkpoint their filesystem. If you save a token to disk and then checkpoint the Sprite, that secret-bearing file may become part of the snapshot. That is the tradeoff. It is also why the connector path exists.

Use fallback storage when you understand that cost.

</details>

## Local Dev

For local development, the Sprite CLI is the fastest path.

```bash
sprite login
sprite list
```

Then run the dashboard:

```bash
npm install
npm run dev -- -p 1340
```

Open:

```txt
http://localhost:1340
```

If `sprite list` works, the dashboard can fall back to `sprite api ...`.

## Hosted Sprites

Sprites public URLs route to port `8080` by default.

The production start script uses that port:

```bash
npm start
```

If you override the port, make sure the Sprite URL proxy can reach it. Running the app on `3000` may work inside the Sprite but fail from the public URL.

## Checkpoint With Context

Instead of a bare `sprite checkpoint create` (which lands on the dashboard as a
context-less "mystery hash"), use the `workbench` CLI. It takes the same
Sprites snapshot and auto-writes the description — changed files, intent, and
an optional verification result — so every restore point is a confident
decision, not a gamble:

```bash
npx workbench checkpoint "before auth refactor"
npx workbench checkpoint "deps bump" --verify "npm test"
```

The Sprite is resolved from the local `.sprite` file (override with
`--sprite`). Checkpoints made any other way still show up — the Workbench
observes them passively — but only this command records the rich context.

## Let Your Agent Write The Timeline

Any coding agent (Codex, Claude Code, a custom runner) can record its runs,
file changes, and outcomes into the Workbench timeline instead of using the
manual seed form. See [docs/AGENT_RUNNER.md](docs/AGENT_RUNNER.md) and
[scripts/record-run-event.mjs](scripts/record-run-event.mjs):

```bash
export WORKBENCH_URL="http://localhost:1340"
export SPRITE_NAME="recallmem"
node scripts/record-run-event.mjs start "Fix login redirect bug"
```

## Run The Checks

Before trusting a change:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## Next

The next useful thing is actions.

Right now this is mostly inspection. This weekend I want to add safe checkpoint actions, starting with `revert to this`.

After that:

- per-Sprite detail pages
- status history, so I can see when a Sprite went cold
- agent run tracking with commands, diffs, logs, tests, and summaries
- an optional Codex skill once the product shape settles
