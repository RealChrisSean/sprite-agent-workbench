# Sprite Agent Workbench TODO

This is the working roadmap. Keep this file boring and current.

## Done

- Create standalone Next.js app outside RecallMEM.
- Add read-only overview dashboard.
- Read Sprite data through authenticated local `sprite` CLI.
- Show all Sprites, status counts, URL auth mode, health status, and checkpoint
  history.
- Add evidence-backed warm/cold/running explanations.
- Create private GitHub repo.
- Create `sprite-agent-workbench` Sprite.
- Add hosted `SPRITES_API_TOKEN` mode with local CLI fallback.
- Add user-runnable `npm test` coverage for the Sprite data layer.
- Add CI for lint, tests, typecheck, and build.
- Add a per-Sprite checkpoint inspector so checkpoint timelines and checkpoint
  API calls are focused on one Sprite instead of visually blending across the
  whole fleet.
- Add grouped running/warm/cold fleet lanes with per-Sprite tooltip evidence for
  larger accounts.
- Add connector-first auth setup:
  - `SPRITES_API_GATEWAY_BASE_URL` for Sprites Connector mode.
  - `SPRITES_API_TOKEN` for server-env token mode.
  - server-only fallback token form with same-origin protection and scary
    checkpoint warning.
- Rewrite README around the secure setup model and checkpoint risk.

## Next

1. Add setup docs for deploying hosted mode on a Sprite.
   - Include the Sprites Connector path first.
   - Explain where to set `SPRITES_API_GATEWAY_BASE_URL`.
   - Explain where to set `SPRITES_API_TOKEN` when using env-token mode.
   - Explain that local CLI mode still works without a token.

2. Add per-Sprite detail pages.
   - Route: `/sprites/[name]`.
   - Show status, URL auth, health, checkpoint timeline, latest checkpoint,
     last running, last warming, and fetch errors.

3. Add local status history.
   - Store observations over time.
   - Answer "when did this Sprite go cold?"
   - Start with SQLite unless hosted mode clearly needs Postgres first.

4. Add checkpoint actions.
   - Create checkpoint.
   - Restore checkpoint only after explicit confirmation.
   - Add checkpoint comments where the API supports it.
   - Keep "clean start" checkpoint semantics: clone/install first, then
     checkpoint, then run agent instructions.

5. Add agent run tracking.
   - Track task prompt, target Sprite, starting checkpoint, ending checkpoint,
     commands, file diffs, test results, logs, and final summary.

6. Add optional Codex skill.
   - The repo remains the product.
   - The skill helps Codex inspect Sprites, explain state, create safe
     checkpoints, and summarize agent runs.

7. Add hosted onboarding screen.
   - Show token-mode instructions when hosted auth is missing.
   - Show CLI-mode instructions when local auth is missing.

8. Keep tests attached to every feature.
   - Add or update unit tests for new data behavior.
   - Add integration tests when route/UI behavior matters.
   - Document manual checks only when automation is not practical yet.

## Non-Goals For Now

- Do not replace the official Sprites dashboard.
- Do not manage billing.
- Do not require GitHub connectors.
- Do not run arbitrary agent commands yet.
- Do not restore checkpoints automatically.
- Do not hardcode RecallMEM behavior.
