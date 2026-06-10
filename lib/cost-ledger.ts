import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ACTIVE_STATUSES = new Set(["running", "warm"]);
const DEFAULT_OBSERVATION_LIMIT = 5_000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_OBSERVED_INTERVAL_MS = 30 * 60 * 1000;
const MAX_OPEN_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_OBSERVATIONS_PATH = join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".workbench-state",
  "sprite-observations.jsonl"
);

export interface ObservableSprite {
  name: string;
  status: string;
  organization: string;
  url: string | null;
  url_settings?: {
    auth?: string;
  };
  last_running_at: string | null;
  last_warming_at: string | null;
  checkpoints?: unknown[];
  checkpointCountLoaded?: boolean;
}

export interface SpriteObservation {
  observedAt: string;
  spriteName: string;
  organization: string;
  status: string;
  urlAuth: string;
  hasUrl: boolean;
  lastRunningAt: string | null;
  lastWarmingAt: string | null;
  checkpointCount: number | null;
  checkpointCountLoaded: boolean;
  source: string;
}

export interface CostRiskFlag {
  severity: "info" | "warning" | "danger";
  label: string;
  detail: string;
}

export interface SpriteExposureSummary {
  spriteName: string;
  organization: string;
  currentStatus: string;
  currentUrlAuth: string;
  observedAt: string;
  observationCount: number;
  observedActiveMs: number;
  lastObservedActiveAt: string | null;
  checkpointCount: number | null;
  checkpointCountLoaded: boolean;
  riskFlags: CostRiskFlag[];
}

export interface CostExposureSummary {
  generatedAt: string;
  windowStartedAt: string;
  disclaimer: string;
  observationCount: number;
  runningNow: number;
  warmNow: number;
  activeNow: number;
  publicUrlCount: number;
  totalObservedActiveMs: number;
  writeError: string | null;
  riskFlags: CostRiskFlag[];
  sprites: SpriteExposureSummary[];
}

export function getSpriteObservationPath(): string {
  const explicitPath =
    process.env.SPRITE_AGENT_WORKBENCH_OBSERVATIONS_PATH?.trim();
  return explicitPath || DEFAULT_OBSERVATIONS_PATH;
}

export async function observeCostExposure({
  sprites,
  source,
  observedAt = new Date(),
}: {
  sprites: ObservableSprite[];
  source: string;
  observedAt?: Date;
}): Promise<CostExposureSummary> {
  const observations = sprites.map((sprite) =>
    createSpriteObservation(sprite, source, observedAt)
  );
  let writeError: string | null = null;

  try {
    await appendSpriteObservations(observations);
  } catch (err) {
    writeError = err instanceof Error ? err.message : String(err);
  }

  let storedObservations = observations;
  if (!writeError) {
    try {
      storedObservations = await readSpriteObservations();
    } catch (err) {
      writeError = err instanceof Error ? err.message : String(err);
    }
  }

  return buildCostExposureSummary({
    observations: storedObservations,
    currentObservations: observations,
    now: observedAt,
    writeError,
  });
}

export async function appendSpriteObservations(
  observations: SpriteObservation[]
): Promise<void> {
  if (observations.length === 0) return;

  const path = getSpriteObservationPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(
    path,
    observations.map((observation) => JSON.stringify(observation)).join("\n") +
      "\n",
    { encoding: "utf8", mode: 0o600 }
  );
}

export async function readSpriteObservations(
  limit = DEFAULT_OBSERVATION_LIMIT
): Promise<SpriteObservation[]> {
  let text = "";

  try {
    text = await readFile(getSpriteObservationPath(), "utf8");
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isSpriteObservation(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, Math.max(1, limit));
}

export function buildCostExposureSummary({
  observations,
  currentObservations,
  now = new Date(),
  writeError = null,
}: {
  observations: SpriteObservation[];
  currentObservations: SpriteObservation[];
  now?: Date;
  writeError?: string | null;
}): CostExposureSummary {
  const generatedAt = now.toISOString();
  const windowStartedAt = new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();
  const currentByName = new Map(
    currentObservations.map((observation) => [
      observation.spriteName,
      observation,
    ])
  );
  const summaries = [...currentByName.values()]
    .map((current) =>
      buildSpriteExposureSummary({
        current,
        observations: observations.filter(
          (observation) => observation.spriteName === current.spriteName
        ),
        now,
        windowStartedAt,
      })
    )
    .sort((a, b) => {
      const activeDiff = b.observedActiveMs - a.observedActiveMs;
      if (activeDiff !== 0) return activeDiff;
      return a.spriteName.localeCompare(b.spriteName);
    });
  const runningNow = currentObservations.filter(
    (observation) => observation.status === "running"
  ).length;
  const warmNow = currentObservations.filter(
    (observation) => observation.status === "warm"
  ).length;
  const publicUrlCount = currentObservations.filter(
    (observation) => observation.urlAuth === "public"
  ).length;
  const totalObservedActiveMs = summaries.reduce(
    (total, summary) => total + summary.observedActiveMs,
    0
  );

  return {
    generatedAt,
    windowStartedAt,
    disclaimer:
      "Estimated from Workbench observations, not official Fly or Sprites billing.",
    observationCount: observations.length,
    runningNow,
    warmNow,
    activeNow: runningNow + warmNow,
    publicUrlCount,
    totalObservedActiveMs,
    writeError,
    riskFlags: buildFleetRiskFlags({
      runningNow,
      warmNow,
      publicUrlCount,
      totalObservedActiveMs,
      writeError,
      observationCount: observations.length,
      currentCount: currentObservations.length,
    }),
    sprites: summaries,
  };
}

function createSpriteObservation(
  sprite: ObservableSprite,
  source: string,
  observedAt: Date
): SpriteObservation {
  return {
    observedAt: observedAt.toISOString(),
    spriteName: sprite.name,
    organization: sprite.organization,
    status: sprite.status,
    urlAuth: sprite.url_settings?.auth || "unknown",
    hasUrl: Boolean(sprite.url),
    lastRunningAt: sprite.last_running_at,
    lastWarmingAt: sprite.last_warming_at,
    checkpointCount: sprite.checkpointCountLoaded
      ? sprite.checkpoints?.length ?? 0
      : null,
    checkpointCountLoaded: Boolean(sprite.checkpointCountLoaded),
    source,
  };
}

function buildSpriteExposureSummary({
  current,
  observations,
  now,
  windowStartedAt,
}: {
  current: SpriteObservation;
  observations: SpriteObservation[];
  now: Date;
  windowStartedAt: string;
}): SpriteExposureSummary {
  const sorted = observations
    .filter((observation) => observation.spriteName === current.spriteName)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const observedActiveMs = calculateObservedActiveMs(
    sorted,
    now,
    new Date(windowStartedAt)
  );
  const lastObservedActiveAt =
    [...sorted].reverse().find((observation) => isActive(observation.status))
      ?.observedAt ?? null;

  return {
    spriteName: current.spriteName,
    organization: current.organization,
    currentStatus: current.status,
    currentUrlAuth: current.urlAuth,
    observedAt: current.observedAt,
    observationCount: sorted.length,
    observedActiveMs,
    lastObservedActiveAt,
    checkpointCount: current.checkpointCount,
    checkpointCountLoaded: current.checkpointCountLoaded,
    riskFlags: buildSpriteRiskFlags({
      current,
      observedActiveMs,
      observationCount: sorted.length,
    }),
  };
}

function calculateObservedActiveMs(
  observations: SpriteObservation[],
  now: Date,
  windowStartedAt: Date
): number {
  const nowMs = now.getTime();
  const windowStartMs = windowStartedAt.getTime();
  let total = 0;

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (!isActive(observation.status)) continue;

    const observedMs = Date.parse(observation.observedAt);
    if (Number.isNaN(observedMs)) continue;

    const nextObservedMs =
      index + 1 < observations.length
        ? Date.parse(observations[index + 1].observedAt)
        : nowMs;
    if (Number.isNaN(nextObservedMs)) continue;

    const cap =
      index + 1 < observations.length
        ? MAX_OBSERVED_INTERVAL_MS
        : MAX_OPEN_INTERVAL_MS;
    const startMs = Math.max(observedMs, windowStartMs);
    const endMs = Math.min(nextObservedMs, observedMs + cap, nowMs);

    if (endMs > startMs) {
      total += endMs - startMs;
    }
  }

  return total;
}

function buildFleetRiskFlags({
  runningNow,
  warmNow,
  publicUrlCount,
  totalObservedActiveMs,
  writeError,
  observationCount,
  currentCount,
}: {
  runningNow: number;
  warmNow: number;
  publicUrlCount: number;
  totalObservedActiveMs: number;
  writeError: string | null;
  observationCount: number;
  currentCount: number;
}): CostRiskFlag[] {
  const flags: CostRiskFlag[] = [];

  if (runningNow > 0) {
    flags.push({
      severity: "warning",
      label: `${runningNow} running now`,
      detail: "Running Sprites are the clearest cost-exposure signal.",
    });
  }
  if (warmNow > 0) {
    flags.push({
      severity: "info",
      label: `${warmNow} warm now`,
      detail: "Warm Sprites were recently touched or are ready to resume.",
    });
  }
  if (publicUrlCount > 0) {
    flags.push({
      severity: "danger",
      label: `${publicUrlCount} public URL${publicUrlCount === 1 ? "" : "s"}`,
      detail: "Public URLs can receive traffic without an interactive session.",
    });
  }
  if (totalObservedActiveMs >= 60 * 60 * 1000) {
    flags.push({
      severity: "warning",
      label: "More than 1h observed active",
      detail:
        "Workbench has seen warm/running states for at least an hour in the last 24h.",
    });
  }
  if (writeError) {
    flags.push({
      severity: "warning",
      label: "Ledger write failed",
      detail: writeError,
    });
  } else if (observationCount <= currentCount) {
    flags.push({
      severity: "info",
      label: "New ledger",
      detail:
        "Refresh a few times over normal use before treating observed active time as useful.",
    });
  }

  return flags;
}

function buildSpriteRiskFlags({
  current,
  observedActiveMs,
  observationCount,
}: {
  current: SpriteObservation;
  observedActiveMs: number;
  observationCount: number;
}): CostRiskFlag[] {
  const flags: CostRiskFlag[] = [];

  if (current.status === "running") {
    flags.push({
      severity: "warning",
      label: "Running now",
      detail: "This Sprite is active at the latest refresh.",
    });
  } else if (current.status === "warm") {
    flags.push({
      severity: "info",
      label: "Warm now",
      detail: "This Sprite was recently touched or is ready to resume.",
    });
  }
  if (current.urlAuth === "public") {
    flags.push({
      severity: "danger",
      label: "Public URL",
      detail: "Traffic can reach this app without Sprite auth.",
    });
  }
  if (observedActiveMs >= 30 * 60 * 1000) {
    flags.push({
      severity: "warning",
      label: "30m+ observed active",
      detail: "Workbench has observed this Sprite active across multiple refreshes.",
    });
  }
  if (
    current.checkpointCountLoaded &&
    current.checkpointCount !== null &&
    current.checkpointCount >= 10
  ) {
    flags.push({
      severity: "info",
      label: "Many checkpoints",
      detail: "Checkpoint history can imply storage growth over time.",
    });
  }
  if (observationCount < 2) {
    flags.push({
      severity: "info",
      label: "Needs more observations",
      detail: "One snapshot can show current state, not a trend.",
    });
  }

  return flags;
}

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

function isSpriteObservation(value: unknown): value is SpriteObservation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpriteObservation>;
  return (
    typeof candidate.observedAt === "string" &&
    typeof candidate.spriteName === "string" &&
    typeof candidate.organization === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.urlAuth === "string" &&
    typeof candidate.hasUrl === "boolean" &&
    typeof candidate.checkpointCountLoaded === "boolean" &&
    typeof candidate.source === "string"
  );
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
