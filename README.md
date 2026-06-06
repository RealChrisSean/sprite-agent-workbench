# Sprite Agent Workbench

Sprite Agent Workbench is a visual dashboard for people building with Sprites.

Sprites give agents a persistent computer: files, checkpoints, URLs, sleep/wake behavior, and state that can survive past one command. That is powerful, but it also makes the terminal a worse default interface for a lot of builders.

Advanced developers can live in the CLI. They can list Sprites, inspect logs, check checkpoints, restore state, and keep the whole system in their head. A lot of AI builders do not want that. They want to see what is running, what is asleep, which checkpoint matters, and what they can safely continue from.

This app is for that layer.

It does not replace the Sprites dashboard. It is a workbench you keep open while building with Sprites so fleet state, warm/cold signals, URL auth, and checkpoint history are visible in one place.

RecallMEM is the first dogfood target, but this app is not hardcoded to RecallMEM. If the configured account can see a Sprite, the workbench can show it.

## Who This Is For

Use this if you are building with Sprites and want a visual way to answer questions like:

- Which Sprites are running?
- Which ones are warm, cold, or unknown?
- Why does the app think a Sprite is warm or cold?
- Which Sprite exposes a public URL?
- Which checkpoint should I trust?
- Which Sprite should I keep working from?
- Did my app wake slowly, or was it already warm?

The goal is not to hide the terminal. The goal is to make persistent agent computers easier to inspect, especially for builders who would rather click through state than memorize another stack of commands.

## What It Shows

The fleet view shows:

- every Sprite visible to the configured account
- running, warm, cold, and unknown states
- why the app thinks a Sprite is warm or cold
- URL auth mode for each Sprite
- last running and last warming timestamps
- status lanes that still work with 20, 50, or 100 Sprites

The selected Sprite view shows:

- a focused checkpoint timeline
- checkpoint timestamps
- checkpoint context
- the state you would use for a future `revert to this` action

Checkpoints are only useful if you can tell what they are, when they happened, and whether they are the state you want to trust.

## The Security Rule

The browser should never receive the raw Sprites API token.

Do not put the token in `localStorage`.

Do not put it in a cookie.

Do not put it in a URL.

Do not prefix it with `NEXT_PUBLIC_`.

The dashboard needs server-side access to Sprites. There are four ways to get that access, in this order.

## Best: Use A Sprites Connector

Use a Sprites Connector when you can.

Sprites Connectors store credentials encrypted in your organization and route requests through the Sprites gateway. The dashboard server calls the gateway. The raw token stays out of the app.

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

This is the cleanest path because the Sprite never stores the raw API token. If you rotate the credential, you rotate it in the connector instead of touching every app environment.

Docs: [Sprites Connectors](https://docs.sprites.dev/concepts/connectors/)

## Good: Use A Server Env Token

A server env token is simpler and still reasonable for a self-hosted dashboard.

```bash
SPRITES_API_TOKEN=your-server-only-token
```

The token stays on the server. The browser never receives it.

The tradeoff is that the Sprite process now holds a long-lived token. That is less clean than a connector, but still much better than putting the token in frontend code.

## Fallback: Paste The Token In The Dashboard

The dashboard includes a token paste flow because setup friction is real.

It is not the recommended path.

When you paste a token into the fallback form:

- the browser sends it once to `/api/setup/token`
- the server validates it against the Sprites API
- the server writes it outside the repo
- the file is created with `600` permissions
- the token is never returned to the browser
- the app reads it at runtime

Default path:

```txt
~/.sprite-agent-workbench/secrets.json
```

Override path:

```bash
SPRITE_AGENT_WORKBENCH_SECRET_PATH=/home/sprite/.sprite-agent-workbench/secrets.json
```

The sharp edge is checkpoints. Sprites have filesystem checkpoints, so if you save a fallback token to disk and then create a checkpoint, that secret-bearing file may become part of the snapshot.

That is why the connector path exists. Use fallback storage only when you understand the checkpoint tradeoff.

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

## Hosted Sprites: Listen On 8080

Sprites public URLs route to port `8080` by default.

The production start script uses that port:

```bash
npm start
```

If you override the port, make sure the Sprite URL proxy can reach it. Running the app on `3000` may work inside the Sprite but fail from the public URL.

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

Planned work:

- Add per-Sprite detail pages.
- Add status history so the workbench can answer when a Sprite went cold.
- Add safe checkpoint actions, including `revert to this`.
- Track agent runs with commands, diffs, logs, tests, and summaries.
- Turn this into an optional Codex skill once the product shape settles.

If agents get persistent computers, builders need a way to inspect those computers without guessing.
