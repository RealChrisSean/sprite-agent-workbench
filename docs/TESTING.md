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
- URL/auth handling: auth-gated URLs should not run public health checks.
- Future checkpoint actions: restore must require explicit confirmation.

## Current Test Coverage

The current unit tests cover:

- Parsing noisy `sprite api` CLI output.
- Detecting hosted `SPRITES_API_TOKEN` mode.
- Falling back to CLI mode when no token is set.
- Building predictable Sprites API URLs.
- Formatting API auth errors.
- Fetching dashboard data through hosted token mode.
- Returning a clear setup error when the hosted token is invalid.

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
