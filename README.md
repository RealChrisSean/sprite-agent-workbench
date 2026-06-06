# Sprite Agent Workbench

Sprites give agents a persistent computer.

That is the good part.

It also creates a new problem: now you need to know what state that computer is
in. Is it running? Warm? Cold? Did it checkpoint? Which checkpoint matters? Why
did the app wake slowly? Which Sprite is the one you should restore?

Sprite Agent Workbench is a small dashboard for that layer.

It does not replace the Sprites dashboard. It is the thing you keep open when
you are building with Sprites and want the operational story in one place.

## What It Shows

- Every Sprite visible to the configured account.
- Which Sprites are running, warm, cold, or in an unknown state.
- Why the app thinks a Sprite is cold or warm.
- URL auth mode for each Sprite.
- Last running and last warming timestamps.
- A focused checkpoint timeline for one selected Sprite.
- Fleet status lanes that still work when you have 20, 50, or 100 Sprites.

RecallMEM is the first dogfood target, but the app is not hardcoded to
RecallMEM. If the configured account can see a Sprite, the workbench can show it.

## The Security Rule

Do not make the Sprites API token part of the frontend.

Do not put it in `localStorage`.

Do not put it in a cookie.

Do not put it in a URL.

Do not prefix it with `NEXT_PUBLIC_`.

The dashboard needs server-side access to Sprites. There are four ways to get
that access, in this order.

## Best: Use A Sprites Connector

This is the path to prefer.

Sprites Connectors store credentials encrypted in your organization and route
requests through the Sprites gateway. The Sprite calls the gateway. The raw
token stays out of the app.

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

The app appends Sprites API paths to that gateway URL, for example:

```txt
/v1/sprites/
/v1/sprites/<name>/checkpoints
```

Why this is better: the Sprite never stores the raw API token. If you rotate the
credential, you rotate it in the connector, not inside every app environment.

Docs: [Sprites Connectors](https://docs.sprites.dev/concepts/connectors/)

## Good: Use A Server Env Token

This is simpler and still acceptable for a self-hosted dashboard.

```bash
SPRITES_API_TOKEN=your-server-only-token
```

The token stays on the server. The browser never receives it.

Tradeoff: the Sprite process now holds a long-lived token. That is less clean
than a connector. It is still far better than putting the token in the browser.

## Fallback: Paste The Token In The Dashboard

The dashboard includes this because setup friction is real.

It is not the recommended path.

When you paste a token into the fallback form:

- the browser sends it once to `/api/setup/token`,
- the server validates it against the Sprites API,
- the server writes it outside the repo,
- the file is created with `600` permissions,
- the token is never returned to the browser,
- and the app reads it at runtime.

Default path:

```txt
~/.sprite-agent-workbench/secrets.json
```

Override path:

```bash
SPRITE_AGENT_WORKBENCH_SECRET_PATH=/home/sprite/.sprite-agent-workbench/secrets.json
```

The scary part: Sprites have filesystem checkpoints. If you save a fallback
token to disk and then create a checkpoint, that secret-bearing file may become
part of the snapshot. That is why the connector path exists.

Use fallback storage only when you understand that tradeoff.

## Local Dev: Use The Sprite CLI

For local development, the fastest path is still the CLI.

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

## Auth Source Priority

The app checks credentials in this order:

1. `SPRITES_API_GATEWAY_BASE_URL`
2. `SPRITES_API_TOKEN`
3. saved fallback token file
4. local `sprite` CLI

The first configured source wins.

## Run The Checks

Before trusting a change:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## Next

- Add per-Sprite detail pages.
- Add status history so the workbench can answer when a Sprite went cold.
- Add safe checkpoint actions.
- Track agent runs with commands, diffs, logs, tests, and summaries.
- Turn this into an optional Codex skill once the product shape settles.
