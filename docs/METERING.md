# Metering — near-exact usage & cost

Sprites bill for **actual CPU cycles, resident memory, and consumed storage** —
not wall-clock uptime. A 4-hour mostly-idle session bills ~2.4 CPU-hours, not 4.
So uptime is the wrong number for cost; it's only a "something is running /
forgotten" signal.

This adds an **accurate tier** that measures the same quantities the platform
bills from, by reading them from *inside* the Sprite.

## Two tiers

| Tier | Source | What it answers | Accuracy |
|---|---|---|---|
| Smoke detector | `cost-ledger.ts` (state polling) | Is anything running / public / lingering? | Coarse, zero-install, whole fleet |
| **Meter** (this) | `sprite-meter.mjs` (cgroup counters) | What will I actually pay? | Near-exact, opt-in per Sprite |

## How the meter works

An on-Sprite reader samples and POSTs raw counters to the Workbench:

| Billed quantity | Source inside the Sprite | Nature |
|---|---|---|
| CPU-seconds | `/sys/fs/cgroup/cpu.stat` → `usage_usec` | **cumulative counter** |
| Resident memory | `/sys/fs/cgroup/memory.current` | instantaneous |
| Storage (hot/cold) | `du -sb` on the data dirs | instantaneous |

The server ([lib/metering.ts](../lib/metering.ts)) aggregates the samples and
multiplies by a rate card transcribed from the Billing page.

### Why CPU is *exact* and memory/storage are ~99%

`cpu.stat`'s `usage_usec` is a monotonic cumulative counter, so the delta between
any two samples is the exact CPU consumed in that window — **no aliasing,
regardless of sample rate.** Memory and storage are instantaneous, so they are
trapezoid-integrated over time, which carries a small, sample-rate-dependent
error.

### Honesty guarantees in the math

- **Counter resets** (cold→warm cycles, checkpoint/restore recreate the cgroup)
  are detected (counter goes backwards) and counted, not turned into negatives.
- **Reader-down gaps**: CPU still counts across them (cumulative survives), but
  memory/storage are **not** integrated across a gap longer than `maxGapMs`
  (default 5 min) — we lower `coverage` instead of inventing usage.
- `confidence` is derived from coverage + resets, never asserted.

## Running the reader

```bash
# Inside the Sprite (real counters):
SPRITE_NAME=my-sprite node scripts/sprite-meter.mjs

# Local demo / CI (no cgroup needed):
METER_SOURCE=synthetic METER_INTERVAL_MS=2000 \
  SPRITE_NAME=my-sprite node scripts/sprite-meter.mjs
```

On `SIGINT`/`SIGTERM` it takes one final sample to capture the tail CPU.

Env: `WORKBENCH_URL`, `SPRITE_NAME` (or `./.sprite`), `METER_INTERVAL_MS`,
`METER_SOURCE`, `METER_HOT_DIR`, `METER_COLD_DIR`. Rate-card overrides live in
[.env.example](../.env.example).

## Proving "99%": reconciliation

Reading the right counters makes 99% *possible*; it does not *prove* it. Three
unknowns we can't see from outside can still shift dollars: the exact storage
definition (dedup/compression), rounding rules, and any free allowance.

`reconcile(summary, invoice, targetPct)` in [lib/metering.ts](../lib/metering.ts)
compares a computed summary against one real invoice, reporting per-component and
total % error and whether it's within target. Run the meter for a billing
period, reconcile once, and that single comparison both proves the number and
calibrates the unknowns. Until then the UI labels the figure "not an official
invoice."

## Files

- [lib/metering.ts](../lib/metering.ts) — pure aggregation, cost, reconciliation
- [lib/meter-store.ts](../lib/meter-store.ts) — JSONL sample persistence
- [scripts/meter-core.mjs](../scripts/meter-core.mjs) — pure reader helpers + samplers
- [scripts/sprite-meter.mjs](../scripts/sprite-meter.mjs) — the on-Sprite reader bin
- `app/api/meter/samples` — ingest (same-origin, validated)
- `app/api/meter/summary` — aggregated summary JSON
- Per-Sprite "Metered usage" panel in `app/sprite/[name]/page.tsx`
- Tests: `tests/metering.test.ts`, `tests/meter-core.test.ts`, `tests/meter-store.test.ts`
