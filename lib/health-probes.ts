import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_PROBES_PATH = join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".workbench-state",
  "health-probes.jsonl"
);
const DEFAULT_EXPECTED_STATUSES = "200-399";
const MAX_PROBE_RECORDS = 5_000;

export interface HealthCheckResult {
  status: "ok" | "blocked" | "failed" | "skipped";
  label: string;
  detail: string;
  observedAt?: string;
  path?: string;
  expectedStatuses?: string;
}

export interface HealthProbeRecord extends HealthCheckResult {
  spriteName: string;
  observedAt: string;
  path: string;
  expectedStatuses: string;
  httpStatus: number | null;
}

export function getHealthProbesPath(): string {
  return (
    process.env.SPRITE_AGENT_WORKBENCH_HEALTH_PROBES_PATH?.trim() ||
    DEFAULT_PROBES_PATH
  );
}

export function validateHealthProbePath(value: unknown): string {
  if (value === undefined || value === null || value === "") return "/";
  if (typeof value !== "string") {
    throw new Error("Health path must be a string.");
  }

  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Health path must be a relative path beginning with one slash.");
  }
  if (path.length > 256) {
    throw new Error("Health path must be 256 characters or fewer.");
  }

  const parsed = new URL(path, "https://health.invalid");
  if (parsed.origin !== "https://health.invalid" || parsed.hash) {
    throw new Error("Health path must stay on the Sprite URL and cannot include a fragment.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function validateExpectedStatuses(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_EXPECTED_STATUSES;
  }
  if (typeof value !== "string") {
    throw new Error("Expected statuses must be a string.");
  }

  const ranges = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d{3})(?:-(\d{3}))?$/);
      if (!match) {
        throw new Error("Expected statuses must look like 200-399,404.");
      }
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (start < 100 || end > 599 || end < start) {
        throw new Error("Expected status ranges must stay between 100 and 599.");
      }
      return start === end ? String(start) : `${start}-${end}`;
    });

  if (ranges.length === 0 || ranges.length > 12) {
    throw new Error("Provide between 1 and 12 expected status ranges.");
  }
  return ranges.join(",");
}

export function statusMatchesExpectation(
  status: number,
  expectedStatuses: string
): boolean {
  return expectedStatuses.split(",").some((item) => {
    const [startText, endText = startText] = item.split("-");
    return status >= Number(startText) && status <= Number(endText);
  });
}

export async function probePublicSpriteHealth({
  spriteName,
  spriteUrl,
  urlAuth,
  path: pathInput,
  expectedStatuses: expectedInput,
  now = new Date(),
  fetchImpl = fetch,
}: {
  spriteName: string;
  spriteUrl: string | null;
  urlAuth?: string;
  path?: unknown;
  expectedStatuses?: unknown;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<HealthProbeRecord> {
  const path = validateHealthProbePath(pathInput);
  const expectedStatuses = validateExpectedStatuses(expectedInput);
  const observedAt = now.toISOString();

  if (!spriteUrl) {
    return {
      spriteName,
      status: "skipped",
      label: "No URL",
      detail: "This Sprite does not expose an app URL.",
      observedAt,
      path,
      expectedStatuses,
      httpStatus: null,
    };
  }
  if (urlAuth && urlAuth !== "public") {
    return {
      spriteName,
      status: "blocked",
      label: "Auth gated",
      detail: `URL auth is '${urlAuth}', so an unauthenticated HTTP probe was not sent.`,
      observedAt,
      path,
      expectedStatuses,
      httpStatus: null,
    };
  }

  try {
    const url = new URL(path, spriteUrl);
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const matches = statusMatchesExpectation(response.status, expectedStatuses);
    const label = `${response.status} ${response.statusText || ""}`.trim();
    return {
      spriteName,
      status: matches ? "ok" : "failed",
      label,
      detail: matches
        ? `GET ${path} matched the configured ${expectedStatuses} expectation.`
        : `GET ${path} did not match the configured ${expectedStatuses} expectation.`,
      observedAt,
      path,
      expectedStatuses,
      httpStatus: response.status,
    };
  } catch (err) {
    return {
      spriteName,
      status: "failed",
      label: "No response",
      detail: err instanceof Error ? err.message : String(err),
      observedAt,
      path,
      expectedStatuses,
      httpStatus: null,
    };
  }
}

export async function recordHealthProbe(
  record: HealthProbeRecord
): Promise<void> {
  const path = getHealthProbesPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function readLatestHealthProbes(): Promise<
  Map<string, HealthProbeRecord>
> {
  let text = "";
  try {
    text = await readFile(getHealthProbesPath(), "utf8");
  } catch (err) {
    if (isMissingFileError(err)) return new Map();
    throw err;
  }

  const records = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-MAX_PROBE_RECORDS)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return isHealthProbeRecord(value) ? [value] : [];
      } catch {
        return [];
      }
    });
  const latest = new Map<string, HealthProbeRecord>();
  for (const record of records) latest.set(record.spriteName, record);
  return latest;
}

export function getHealthWithoutProbe({
  url,
  urlAuth,
}: {
  url: string | null;
  urlAuth?: string;
}): HealthCheckResult {
  if (!url) {
    return {
      status: "skipped",
      label: "No URL",
      detail: "This Sprite does not expose an app URL.",
    };
  }
  if (urlAuth && urlAuth !== "public") {
    return {
      status: "blocked",
      label: "Auth gated",
      detail: `URL auth is '${urlAuth}'. Workbench does not probe auth-gated URLs.`,
    };
  }
  return {
    status: "skipped",
    label: "Not probed",
    detail: "No explicit HTTP probe has been recorded. Sending one may wake this Sprite.",
  };
}

function isHealthProbeRecord(value: unknown): value is HealthProbeRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HealthProbeRecord>;
  return (
    typeof candidate.spriteName === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.detail === "string" &&
    typeof candidate.observedAt === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.expectedStatuses === "string" &&
    (candidate.httpStatus === null || typeof candidate.httpStatus === "number")
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
