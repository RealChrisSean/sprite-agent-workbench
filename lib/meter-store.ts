// Persistence for raw meter samples posted by the on-Sprite reader. Mirrors the
// JSONL append-only pattern used by cost-ledger.ts and agent-runs.ts: validate
// strictly on the way in, tolerate junk lines on the way out.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateSpriteNameInput } from "./sprites";
import type { MeterSample } from "./metering";

const DEFAULT_SAMPLE_LIMIT = 5_000;
const DEFAULT_METER_SAMPLES_PATH = join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".workbench-state",
  "meter-samples.jsonl"
);

export function getMeterSamplesPath(): string {
  const explicitPath = process.env.SPRITE_AGENT_WORKBENCH_METER_SAMPLES_PATH?.trim();
  return explicitPath || DEFAULT_METER_SAMPLES_PATH;
}

export async function recordMeterSample(
  input: unknown,
  now = new Date()
): Promise<MeterSample> {
  const sample = validateMeterSampleInput(input, now);
  const path = getMeterSamplesPath();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(sample)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return sample;
}

export async function readMeterSamples(
  spriteNameInput?: unknown,
  limit = DEFAULT_SAMPLE_LIMIT
): Promise<MeterSample[]> {
  const spriteName =
    spriteNameInput === undefined || spriteNameInput === null
      ? null
      : validateSpriteNameInput(spriteNameInput);
  const path = getMeterSamplesPath();
  let text = "";

  try {
    text = await readFile(path, "utf8");
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
        return isMeterSample(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .filter((sample) => spriteName === null || sample.spriteName === spriteName)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .slice(-Math.max(1, limit));
}

export function validateMeterSampleInput(
  input: unknown,
  now = new Date()
): MeterSample {
  if (!isPlainObject(input)) {
    throw new Error("Meter sample must be an object.");
  }

  const spriteName = validateSpriteNameInput(input.spriteName);
  const observedAt = validateObservedAt(input.observedAt, now);
  const source = validateSource(input.source);

  return {
    spriteName,
    observedAt,
    cpuUsageUsec: validateCounter(input.cpuUsageUsec, "cpuUsageUsec"),
    memCurrentBytes: validateCounter(input.memCurrentBytes, "memCurrentBytes"),
    storageHotBytes: validateCounter(input.storageHotBytes, "storageHotBytes"),
    storageColdBytes: validateCounter(input.storageColdBytes, "storageColdBytes"),
    source,
  };
}

function validateObservedAt(value: unknown, now: Date): string {
  if (value === undefined || value === null || value === "") {
    return now.toISOString();
  }
  if (typeof value !== "string") {
    throw new Error("observedAt must be an ISO timestamp string.");
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error("observedAt is not a valid timestamp.");
  }
  return new Date(ms).toISOString();
}

function validateCounter(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
  return value;
}

function validateSource(value: unknown): string {
  if (value === undefined || value === null || value === "") return "cgroup";
  if (typeof value !== "string") {
    throw new Error("source must be a string.");
  }
  const source = value.trim();
  if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(source)) {
    throw new Error("source contains unsupported characters.");
  }
  return source;
}

function isMeterSample(value: unknown): value is MeterSample {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<MeterSample>;
  return (
    typeof candidate.spriteName === "string" &&
    typeof candidate.observedAt === "string" &&
    typeof candidate.cpuUsageUsec === "number" &&
    typeof candidate.memCurrentBytes === "number" &&
    typeof candidate.storageHotBytes === "number" &&
    typeof candidate.storageColdBytes === "number" &&
    typeof candidate.source === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
