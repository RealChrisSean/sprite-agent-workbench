# Sprite Agent Workbench

<img width="1474" height="846" alt="Sprite Agent Workbench dashboard showing Sprite fleet state" src="https://github.com/user-attachments/assets/335ef865-ee2c-467f-b3b5-d1e213832bad" />

Sprite Agent Workbench is a visual dashboard for building with [Sprites](https://sprites.dev).

I built it because Sprites make agent work persistent, and persistent state gets hard to track fast. Once an agent can keep files, expose URLs, sleep, wake, and checkpoint itself, I want to see what it is doing without digging through commands every time.

This does not replace the Sprites dashboard or the Sprite CLI. It is the workbench I wanted open while building: fleet state, warm/cold signals, URL auth, Services and exec-session evidence, checkpoints, and sampled cost exposure in one place.

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

The selected Sprite view adds read-only Services and exec-session evidence, explicit HTTP health probes, checkpoint provenance, and a confirmation-gated restore action. A page render reads control-plane data and stored ledgers; it does not request Sprite app URLs or append observations.

HTTP probes are explicit because any request to a Sprite URL can wake it. The
probe uses `GET`, lets you configure the path and accepted statuses (including
an intentional `404`), and records when the result was observed.

## Write Access

The dashboard is read-only unless `WORKBENCH_ADMIN_TOKEN` is configured and an
admin unlocks an eight-hour HttpOnly session. Same-origin validation remains a
CSRF control; it is not treated as authorization.

Machine collectors and agent runners use a separate secret:

```bash
WORKBENCH_ADMIN_TOKEN=<random-admin-secret>
WORKBENCH_INGEST_TOKEN=<different-random-ingest-secret>
```

They send the ingest secret in `X-Workbench-Ingest-Token`. Keep both values
server-side and never prefix them with `NEXT_PUBLIC_`.

For this repo's local/hosted pair, provision both without printing them:

```bash
npm run secrets:provision
```

The command reuses existing local values or generates new 32-byte values,
writes ignored `.env.local` files with mode `600`, and streams the remote
payload over stdin so secrets are not embedded in exec-session command text.
Do not create a Sprite checkpoint afterward.

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

Sprites checkpoint the writable filesystem overlay. If you save a token to disk and then checkpoint the Sprite, that secret-bearing file may become part of the snapshot. That is the tradeoff. It is also why the connector path exists.

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

Register the web process as a Sprite Service so it starts again after
hibernation and can be auto-started by an HTTP request. After the first setup,
the deploy command pulls `main`, installs, builds, restarts the Service, and
checks localhost:

```bash
npm run deploy:sprite
```

The deploy path does not create a checkpoint, because the hosted filesystem can
contain `.env.local` and other secret-bearing files.

## Explicit Fleet Collection

Page refresh is read-only. To append fleet status samples and discover
checkpoints created outside the Workbench, run the protected collector:

```bash
WORKBENCH_URL=https://your-workbench.example \
WORKBENCH_INGEST_TOKEN=<secret> \
npm run observe
```

Schedule that command outside the Workbench Sprite if you need regular samples;
a resident polling process would itself affect idle behavior. The UI reports
`Insufficient samples` until at least two collection times exist.

## Checkpoint With Context

Instead of a bare `sprite checkpoint create` (which lands on the dashboard as a
contextless checkpoint ID), use the `workbench` CLI. It takes the same
Sprites writable-overlay snapshot and auto-writes the description: changed
files, intent, and an optional verification result. Every restore point should
be a confident decision, not a gamble.

Install the command once from your clone, then use it anywhere:

```bash
npm link                              # or: npm install -g .
workbench checkpoint "before auth refactor"
workbench checkpoint "deps bump" --verify "npm test"
```

Or run it without installing, from the repo root:

```bash
npm run checkpoint -- "before auth refactor"
# or: node scripts/workbench.mjs checkpoint "before auth refactor"
```

The Sprite is resolved from the local `.sprite` file (override with
`--sprite`). Checkpoints made any other way still appear in the platform list.
The explicit fleet collector records them as `checkpoint_observed`, preserving
both the platform creation time and the later discovery time. Only the wrapper
records rich context at creation time.

> Do not use `npx workbench` — an unrelated `workbench` package exists on npm,
> and npx may download and run it. Use the linked `workbench` binary or the
> `npm run checkpoint` / `node scripts/...` forms above.

## Let Your Agent Write The Timeline

Any coding agent (Codex, Claude Code, a custom runner) can record its runs,
file changes, and outcomes into the Workbench timeline instead of using the
manual seed form. See [docs/AGENT_RUNNER.md](docs/AGENT_RUNNER.md) and
[scripts/record-run-event.mjs](scripts/record-run-event.mjs):

```bash
export WORKBENCH_URL="http://localhost:1340"
export WORKBENCH_INGEST_TOKEN="<app-ingest-secret>"
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

## Cost Language

The fleet ledger is a sampled state-duration estimate, and the per-Sprite meter
is a local counter-based estimate. Neither is an invoice. The meter applies the
published CPU and memory billing floors, labels reset gaps, and treats optional
`du` storage values as directory-size scenario proxies. See
[docs/METERING.md](docs/METERING.md).
