// Counter-based local estimate for Sprites. CPU and memory come from Linux
// cgroup counters, then the published per-second billing floors are applied.
// This is not invoice data: counter resets, missing intervals, platform-side
// sampling, and storage accounting can all move the billed result.

export const BYTES_PER_GB = 1_000_000_000;
export const MINIMUM_CPU_FRACTION = 0.0625;
export const MINIMUM_MEMORY_GB = 0.25;
const USEC_PER_HOUR = 3_600_000_000;
const MS_PER_HOUR = 3_600_000;

// A gap larger than this between two samples means the reader was down. CPU
// still counts across it (cumulative counter), but we do NOT integrate
// memory/storage across an unobserved gap — we'd be inventing data.
export const DEFAULT_MAX_GAP_MS = 5 * 60 * 1000;

/** Published Sprites rates, transcribed from the Billing page. */
export interface RateCard {
  cpuPerHour: number;
  memoryGbPerHour: number;
  hotStorageGbPerHour: number;
  coldStorageGbPerHour: number;
}

export const DEFAULT_RATE_CARD: RateCard = {
  cpuPerHour: 0.07,
  memoryGbPerHour: 0.04375,
  hotStorageGbPerHour: 0.000683,
  coldStorageGbPerHour: 0.000027,
};

/** One raw reading from the on-Sprite reader. All counters are non-negative. */
export interface MeterSample {
  spriteName: string;
  observedAt: string;
  /** Cumulative CPU time from cgroup cpu.stat usage_usec (microseconds). */
  cpuUsageUsec: number;
  /** Instantaneous resident memory from cgroup memory.current (bytes). */
  memCurrentBytes: number;
  /** Instantaneous hot (live/working) storage in bytes. */
  storageHotBytes: number;
  /** Instantaneous cold (checkpoint/archive) storage in bytes. */
  storageColdBytes: number;
  /** Source of the sample, for trust labeling. */
  source: string;
  /** Storage is either unmeasured or a local directory-size proxy. */
  storageMeasurement?: "none" | "directory-du";
}

export interface MeterCostBreakdown {
  cpu: number;
  memory: number;
  hotStorage: number;
  coldStorage: number;
  total: number;
}

export interface MeterSummary {
  spriteName: string | null;
  sampleCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /** Estimated billable CPU-hours after the published per-second floor. */
  cpuHours: number;
  /** Raw CPU counter delta before the billing floor. */
  rawCpuHours: number;
  /** Estimated billable memory GB-hours after the published floor. */
  memoryGbHours: number;
  /** Integrated memory.current before the billing floor. */
  rawMemoryGbHours: number;
  hotStorageGbHours: number;
  coldStorageGbHours: number;
  cost: MeterCostBreakdown;
  rateCard: RateCard;
  /** Number of counter resets detected across the series. */
  cpuResets: number;
  /** Wall-clock span covered by the samples, in ms. */
  spanMs: number;
  /** Span over which memory/storage could be integrated (gaps excluded), ms. */
  integratedMs: number;
  /** integratedMs / spanMs — confidence in the memory/storage figures. */
  coverage: number;
  confidence: "counter-only" | "high" | "medium" | "low";
  notes: string[];
}

/** Read a rate card from env, falling back to the published defaults. */
export function getRateCardFromEnv(
  env: Record<string, string | undefined> = process.env
): RateCard {
  return {
    cpuPerHour: numberFromEnv(env.WORKBENCH_RATE_CPU_PER_HOUR, DEFAULT_RATE_CARD.cpuPerHour),
    memoryGbPerHour: numberFromEnv(
      env.WORKBENCH_RATE_MEMORY_GB_PER_HOUR,
      DEFAULT_RATE_CARD.memoryGbPerHour
    ),
    hotStorageGbPerHour: numberFromEnv(
      env.WORKBENCH_RATE_HOT_STORAGE_GB_PER_HOUR,
      DEFAULT_RATE_CARD.hotStorageGbPerHour
    ),
    coldStorageGbPerHour: numberFromEnv(
      env.WORKBENCH_RATE_COLD_STORAGE_GB_PER_HOUR,
      DEFAULT_RATE_CARD.coldStorageGbPerHour
    ),
  };
}

/**
 * Aggregate a series of raw samples into usage and cost. Pure.
 *
 * CPU is summed from counter deltas and the published utilization floor.
 * Memory and storage are integrated only across observed intervals no longer
 * than maxGapMs. A reset can hide CPU between samples, so reset windows are
 * explicitly marked as uncertain instead of being called exact.
 */
export function summarizeMeterSamples(
  samples: MeterSample[],
  {
    rateCard = DEFAULT_RATE_CARD,
    maxGapMs = DEFAULT_MAX_GAP_MS,
  }: { rateCard?: RateCard; maxGapMs?: number } = {}
): MeterSummary {
  const sorted = [...samples]
    .filter((sample) => Number.isFinite(Date.parse(sample.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const base: MeterSummary = {
    spriteName: sorted[0]?.spriteName ?? null,
    sampleCount: sorted.length,
    firstObservedAt: sorted[0]?.observedAt ?? null,
    lastObservedAt: sorted[sorted.length - 1]?.observedAt ?? null,
    cpuHours: 0,
    rawCpuHours: 0,
    memoryGbHours: 0,
    rawMemoryGbHours: 0,
    hotStorageGbHours: 0,
    coldStorageGbHours: 0,
    cost: { cpu: 0, memory: 0, hotStorage: 0, coldStorage: 0, total: 0 },
    rateCard,
    cpuResets: 0,
    spanMs: 0,
    integratedMs: 0,
    coverage: 0,
    confidence: "low",
    notes: [],
  };

  if (sorted.length === 0) {
    base.notes.push("No samples recorded yet.");
    return base;
  }
  if (sorted.length === 1) {
    base.notes.push("Only one sample — need at least two to measure usage.");
    return base;
  }

  let cpuUsec = 0;
  let billableCpuUsec = 0;
  let cpuResets = 0;
  let memGbHours = 0;
  let billableMemGbHours = 0;
  let hotGbHours = 0;
  let coldGbHours = 0;
  let spanMs = 0;
  let integratedMs = 0;
  let gapCount = 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dtMs = Date.parse(curr.observedAt) - Date.parse(prev.observedAt);
    if (dtMs <= 0) continue;
    spanMs += dtMs;

    // CPU: cumulative counter. Always counts, even across a reader-down gap.
    if (curr.cpuUsageUsec >= prev.cpuUsageUsec) {
      const deltaUsec = curr.cpuUsageUsec - prev.cpuUsageUsec;
      cpuUsec += deltaUsec;
      billableCpuUsec += Math.max(
        deltaUsec,
        (dtMs / 1000) * MINIMUM_CPU_FRACTION * 1_000_000
      );
    } else {
      // Counter went backwards => cgroup was recreated. Best estimate of usage
      // since the reset is the new (post-reset) reading itself.
      cpuUsec += curr.cpuUsageUsec;
      billableCpuUsec += curr.cpuUsageUsec;
      cpuResets += 1;
    }

    // Memory/storage: instantaneous. Integrate only across observed intervals.
    if (dtMs <= maxGapMs) {
      const dtHours = dtMs / MS_PER_HOUR;
      const intervalMemGbHours = trapezoidGb(
        prev.memCurrentBytes,
        curr.memCurrentBytes,
        dtHours
      );
      memGbHours += intervalMemGbHours;
      billableMemGbHours += Math.max(
        intervalMemGbHours,
        MINIMUM_MEMORY_GB * dtHours
      );
      hotGbHours += trapezoidGb(prev.storageHotBytes, curr.storageHotBytes, dtHours);
      coldGbHours += trapezoidGb(prev.storageColdBytes, curr.storageColdBytes, dtHours);
      integratedMs += dtMs;
    } else {
      gapCount += 1;
    }
  }

  const rawCpuHours = cpuUsec / USEC_PER_HOUR;
  const cpuHours = billableCpuUsec / USEC_PER_HOUR;
  const cost = computeCost(
    { cpuHours, memoryGbHours: billableMemGbHours, hotStorageGbHours: hotGbHours, coldStorageGbHours: coldGbHours },
    rateCard
  );
  const coverage = spanMs > 0 ? integratedMs / spanMs : 0;

  const notes: string[] = [];
  if (cpuResets > 0) {
    notes.push(
      `${cpuResets} CPU counter reset${cpuResets === 1 ? "" : "s"} detected (cgroup recreated); CPU before the first post-reset reading is not recoverable from these samples.`
    );
  }
  if (sorted.some((sample) => sample.storageMeasurement === "directory-du")) {
    notes.push(
      "Storage came from local directory sizes. It is a scenario proxy, not the platform hot-cache or object-storage meter."
    );
  }
  if (gapCount > 0) {
    notes.push(
      `${gapCount} gap${gapCount === 1 ? "" : "s"} longer than ${Math.round(maxGapMs / 1000)}s — CPU still counted, memory/storage not integrated across them.`
    );
  }

  return {
    ...base,
    cpuHours,
    rawCpuHours,
    memoryGbHours: billableMemGbHours,
    rawMemoryGbHours: memGbHours,
    hotStorageGbHours: hotGbHours,
    coldStorageGbHours: coldGbHours,
    cost,
    cpuResets,
    spanMs,
    integratedMs,
    coverage,
    confidence: classifyConfidence(coverage, cpuResets),
    notes,
  };
}

export function computeCost(
  usage: {
    cpuHours: number;
    memoryGbHours: number;
    hotStorageGbHours: number;
    coldStorageGbHours: number;
  },
  rateCard: RateCard = DEFAULT_RATE_CARD
): MeterCostBreakdown {
  const cpu = usage.cpuHours * rateCard.cpuPerHour;
  const memory = usage.memoryGbHours * rateCard.memoryGbPerHour;
  const hotStorage = usage.hotStorageGbHours * rateCard.hotStorageGbPerHour;
  const coldStorage = usage.coldStorageGbHours * rateCard.coldStorageGbPerHour;
  return { cpu, memory, hotStorage, coldStorage, total: cpu + memory + hotStorage + coldStorage };
}

export interface Invoice {
  cpu?: number;
  memory?: number;
  hotStorage?: number;
  coldStorage?: number;
  total?: number;
}

export interface ReconciliationLine {
  component: string;
  computed: number;
  actual: number;
  absError: number;
  pctError: number;
}

export interface Reconciliation {
  lines: ReconciliationLine[];
  totalComputed: number;
  totalActual: number;
  totalPctError: number;
  withinTarget: boolean;
}

/**
 * Compare a local estimate against a real invoice. Reconciliation measures the
 * observed error; it does not make future counter estimates invoice-grade.
 */
export function reconcile(
  summary: MeterSummary,
  invoice: Invoice,
  targetPct = 1
): Reconciliation {
  const lines: ReconciliationLine[] = [];
  const add = (component: string, computed: number, actual: number | undefined) => {
    if (actual === undefined) return;
    lines.push({ component, computed, actual, absError: Math.abs(computed - actual), pctError: pctError(computed, actual) });
  };

  add("cpu", summary.cost.cpu, invoice.cpu);
  add("memory", summary.cost.memory, invoice.memory);
  add("hotStorage", summary.cost.hotStorage, invoice.hotStorage);
  add("coldStorage", summary.cost.coldStorage, invoice.coldStorage);

  const totalActual = invoice.total ?? sumDefined([invoice.cpu, invoice.memory, invoice.hotStorage, invoice.coldStorage]);
  const totalComputed = summary.cost.total;
  const totalPctError = pctError(totalComputed, totalActual);

  return {
    lines,
    totalComputed,
    totalActual,
    totalPctError,
    withinTarget: totalPctError <= targetPct,
  };
}

function trapezoidGb(prevBytes: number, currBytes: number, dtHours: number): number {
  const avgBytes = (prevBytes + currBytes) / 2;
  return (avgBytes / BYTES_PER_GB) * dtHours;
}

function classifyConfidence(coverage: number, cpuResets: number): MeterSummary["confidence"] {
  if (coverage <= 0) return "counter-only";
  if (coverage >= 0.95 && cpuResets === 0) return "high";
  if (coverage >= 0.75) return "medium";
  return "low";
}

function pctError(computed: number, actual: number): number {
  if (!Number.isFinite(actual) || actual === 0) return computed === 0 ? 0 : Infinity;
  return (Math.abs(computed - actual) / actual) * 100;
}

function sumDefined(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
