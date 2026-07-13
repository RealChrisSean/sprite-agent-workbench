# Testing

Sprite Agent Workbench should treat tests as part of the feature, not as a
cleanup task after the feature.

## Local Checks

Run the full local check before pushing:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

For fast feedback while changing logic:

```bash
npm run test:watch
```

## What To Test

Every feature should include the smallest test that proves the behavior users
depend on.

Examples:

- Data-source behavior: token mode vs local CLI fallback.
- Error messages: invalid token, missing CLI auth, failed checkpoint fetch.
- Sprite state inference: running, warm, cold, unknown.
- URL/auth handling: dashboard renders must not request public or auth-gated
  Sprite URLs; explicit probes must preserve configured status expectations.
- Future checkpoint actions: restore must require explicit confirmation.
- Write security: browser writes require an admin session and machine writes
  require the dedicated ingest header.

## Current Test Coverage

The current unit tests cover:

- Parsing noisy `sprite api` CLI output.
- Detecting hosted `SPRITES_API_TOKEN` mode.
- Falling back to CLI mode when no token is set.
- Building predictable Sprites API URLs.
- Formatting API auth errors.
- Fetching dashboard data through hosted token mode without waking app URLs.
- Returning a clear setup error when the hosted token is invalid.
- Expiring admin sessions and ingest-token validation.
- Explicit health path/status validation, including intentional `404`.
- Services and exec-session response normalization.
- Decimal-GB metering, CPU/memory billing floors, reset handling, and coverage.
- Read-only cost rendering that does not create ledger files.

## CI

GitHub Actions runs the same basic checks on pushes to `main` and pull
requests:

- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`

If a change cannot be covered by automated tests yet, document the manual test
in the pull request or commit notes and add the missing automated coverage as a
follow-up TODO.
