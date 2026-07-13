# Metering: local counter-based estimates

Sprites bills CPU time, memory time, hot storage, and cold storage. The
Workbench meter is a local estimator for those dimensions. It is not the
Sprites billing system and it does not report an invoice-grade total.

## Two different signals

| Signal | Source | What it can answer |
| --- | --- | --- |
| Fleet observation ledger | Sprites control-plane status | What was running or warm when the protected collector sampled it? |
| Local meter | cgroup counters inside one Sprite | What usage and cost range do these local samples imply? |

Neither is a replacement for the Sprites billing dashboard.

## Inputs and billing floors

The reader samples:

| Dimension | Local input | Important limit |
| --- | --- | --- |
| CPU | `/sys/fs/cgroup/cpu.stat` `usage_usec` | A counter reset can hide usage between samples. |
| Memory | `/sys/fs/cgroup/memory.current` | Instantaneous values must be integrated over sampled intervals. |
| Storage | Optional `du -sb` directories | A directory size is not the platform hot-cache or object-storage meter. |

The estimator uses decimal GB and applies the published minimums of 6.25% CPU
utilization and 0.25 GB of memory for each covered second of runtime. Default
rates are the public rates transcribed into `lib/metering.ts`; verify the live
pricing page before using an estimate for a financial decision.

## Gaps and resets

- A monotonic CPU counter delta is useful within one uninterrupted cgroup
  epoch. It is not called exact.
- If the CPU counter moves backward, the cgroup was recreated. The samples
  cannot recover all usage before the first post-reset reading.
- Memory and storage are integrated only across intervals no longer than five
  minutes by default. Longer gaps lower coverage instead of inventing values.
- `du` storage values are labeled as scenario proxies. Leave the storage env
  vars unset when you do not want those proxy dollars included.

## Ingest authentication

Set a separate app-level secret on the Workbench and on the sampler:

```bash
WORKBENCH_INGEST_TOKEN=<random-secret>
```

The reader sends it in `X-Workbench-Ingest-Token`. If the Workbench Sprite URL
also requires edge authentication, set `WORKBENCH_EDGE_TOKEN`; that value is
sent in `Authorization` and remains separate from app ingest auth.

The client refuses redirects, non-JSON responses, and JSON without `ok: true`.
This prevents a followed sign-in page from being mistaken for successful
ingest.

## Running the reader

One sample is the default and does not start a persistent loop:

```bash
WORKBENCH_URL=https://your-workbench.example \
WORKBENCH_INGEST_TOKEN=<secret> \
SPRITE_NAME=my-sprite \
node scripts/sprite-meter.mjs
```

For a local synthetic sample:

```bash
WORKBENCH_INGEST_TOKEN=<secret> \
METER_SOURCE=synthetic \
SPRITE_NAME=my-sprite \
node scripts/sprite-meter.mjs
```

Continuous mode is explicit:

```bash
node scripts/sprite-meter.mjs --continuous
```

A continuously running meter is itself activity and can prevent a Sprite from
becoming idle. Use it only when that lifecycle effect is intentional, such as
measuring a workload that is already meant to stay awake.

Optional env vars: `METER_INTERVAL_MS`, `METER_HOT_DIR`, `METER_COLD_DIR`,
`WORKBENCH_EDGE_TOKEN`, and the rate-card overrides in `.env.example`.

## Reconciliation

`reconcile(summary, invoice, targetPct)` compares an estimate with a real
invoice. It measures observed error for that period; it does not make future
counter estimates invoice-grade.

## Files

- `lib/metering.ts`: aggregation, floors, rate-card math, reconciliation
- `lib/meter-store.ts`: validated JSONL sample persistence
- `scripts/meter-core.mjs`: cgroup readers and hardened ingest client
- `scripts/sprite-meter.mjs`: one-shot or continuous reader
- `app/api/meter/samples`: token-protected ingest
- `app/api/meter/summary`: read-only summary JSON
