import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SpriteStatus = "cold" | "warm" | "running" | string;

export interface SpriteSummary {
  id: string;
  name: string;
  status: SpriteStatus;
  version: string | null;
  url: string | null;
  url_settings?: {
    auth?: string;
    private_access?: string;
  };
  created_at: string;
  organization: string;
  last_running_at: string | null;
  last_warming_at: string | null;
  updated_at: string;
  environment_version: string | null;
}

export interface SpriteListResponse {
  name: string;
  running: number;
  warm: number;
  cold: number;
  running_limit: number;
  warm_limit: number;
  sprites: SpriteSummary[];
  next_continuation_token: string | null;
  has_more: boolean;
}

export interface SpriteCheckpoint {
  id: string;
  create_time: string;
  comment?: string;
  is_auto?: boolean;
}

export interface SpriteCommandError {
  message: string;
  hint: string;
}

export interface DashboardSprite extends SpriteSummary {
  checkpoints: SpriteCheckpoint[];
  sleep: SleepInference;
  health: HealthCheckResult;
  checkpointError?: string;
}

export interface DashboardData {
  ok: boolean;
  orgName: string | null;
  counts: {
    total: number;
    running: number;
    warm: number;
    cold: number;
    runningLimit: number | null;
    warmLimit: number | null;
  };
  sprites: DashboardSprite[];
  error?: SpriteCommandError;
  fetchedAt: string;
}

export interface SleepInference {
  label: string;
  tone: "good" | "warn" | "neutral";
  evidence: string[];
}

export interface HealthCheckResult {
  status: "ok" | "blocked" | "failed" | "skipped";
  label: string;
  detail: string;
}

async function runSpriteApi<T>(path: string): Promise<T> {
  const { stdout } = await execFileAsync("sprite", ["api", path], {
    maxBuffer: 1024 * 1024 * 5,
  });
  return parseSpriteApiJson<T>(stdout);
}

function parseSpriteApiJson<T>(output: string): T {
  const start = output.search(/[\[{]/);
  if (start === -1) {
    throw new Error(`Sprite API returned no JSON: ${output.slice(0, 200)}`);
  }
  return JSON.parse(output.slice(start)) as T;
}

export async function getDashboardData(): Promise<DashboardData> {
  const fetchedAt = new Date().toISOString();
  try {
    const list = await runSpriteApi<SpriteListResponse>("/v1/sprites");
    const sprites = await Promise.all(
      list.sprites.map(async (sprite) => {
        const [checkpoints, health] = await Promise.all([
          getCheckpoints(sprite.name),
          checkSpriteHealth(sprite),
        ]);

        return {
          ...sprite,
          checkpoints: checkpoints.items,
          checkpointError: checkpoints.error,
          health,
          sleep: inferSleep(sprite, health),
        };
      })
    );

    return {
      ok: true,
      orgName: list.name,
      counts: {
        total: list.sprites.length,
        running: list.running,
        warm: list.warm,
        cold: list.cold,
        runningLimit: list.running_limit,
        warmLimit: list.warm_limit,
      },
      sprites,
      fetchedAt,
    };
  } catch (err) {
    return {
      ok: false,
      orgName: null,
      counts: {
        total: 0,
        running: 0,
        warm: 0,
        cold: 0,
        runningLimit: null,
        warmLimit: null,
      },
      sprites: [],
      fetchedAt,
      error: {
        message: err instanceof Error ? err.message : String(err),
        hint: "Run `sprite login` in your terminal, then refresh this dashboard.",
      },
    };
  }
}

async function getCheckpoints(
  spriteName: string
): Promise<{ items: SpriteCheckpoint[]; error?: string }> {
  try {
    const items = await runSpriteApi<SpriteCheckpoint[]>(
      `/v1/sprites/${encodeURIComponent(spriteName)}/checkpoints`
    );
    return { items };
  } catch (err) {
    return {
      items: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSpriteHealth(sprite: SpriteSummary): Promise<HealthCheckResult> {
  if (!sprite.url) {
    return {
      status: "skipped",
      label: "No URL",
      detail: "This Sprite does not expose an app URL.",
    };
  }

  if (sprite.url_settings?.auth && sprite.url_settings.auth !== "public") {
    return {
      status: "blocked",
      label: "Auth gated",
      detail: `URL auth is '${sprite.url_settings.auth}', so public health checks are intentionally skipped.`,
    };
  }

  try {
    const res = await fetch(sprite.url, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return {
      status: res.ok ? "ok" : "failed",
      label: `${res.status} ${res.statusText || ""}`.trim(),
      detail: res.ok
        ? "The app URL responded to a lightweight health check."
        : "The app URL responded, but not with a successful status.",
    };
  } catch (err) {
    return {
      status: "failed",
      label: "No response",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function inferSleep(
  sprite: SpriteSummary,
  health: HealthCheckResult
): SleepInference {
  const evidence: string[] = [];
  const lastRunning = formatRelativeTime(sprite.last_running_at);
  const lastWarming = formatRelativeTime(sprite.last_warming_at);

  if (lastRunning) evidence.push(`Last running: ${lastRunning}`);
  if (lastWarming) evidence.push(`Last warming: ${lastWarming}`);
  evidence.push(`URL auth: ${sprite.url_settings?.auth || "unknown"}`);
  evidence.push(`Health: ${health.label}`);

  if (sprite.status === "running") {
    return {
      label: "Active now",
      tone: "good",
      evidence: ["Sprites reports this environment is running.", ...evidence],
    };
  }

  if (sprite.status === "warm") {
    return {
      label: "Warm / recently touched",
      tone: "good",
      evidence: [
        "Sprites reports this environment is warm. It may have recently handled API, URL, or session activity.",
        ...evidence,
      ],
    };
  }

  if (sprite.status === "cold") {
    return {
      label: "Likely idle sleep",
      tone: "warn",
      evidence: [
        "Sprites reports this environment is cold.",
        "Most likely cause: no active shell/session and no recent app HTTP traffic.",
        ...evidence,
      ],
    };
  }

  return {
    label: "Unknown status",
    tone: "neutral",
    evidence: [`Sprites reports status '${sprite.status}'.`, ...evidence],
  };
}

export function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (abs < minute) return formatter.format(Math.round(-diffMs / 1000), "second");
  if (abs < hour) return formatter.format(Math.round(-diffMs / minute), "minute");
  if (abs < day) return formatter.format(Math.round(-diffMs / hour), "hour");
  return formatter.format(Math.round(-diffMs / day), "day");
}
