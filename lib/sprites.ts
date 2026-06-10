import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getAuthSourceLabel,
  getSpriteAuthConfig,
  getSpriteAuthStatus,
  type SpriteAuthSource,
  type SpriteAuthStatus,
} from "./sprite-auth";
import {
  buildCostExposureSummary,
  observeCostExposure,
  type CostExposureSummary,
} from "./cost-ledger";

const execFileAsync = promisify(execFile);
const DEFAULT_SPRITES_API_BASE_URL = "https://api.sprites.dev";
const DEFAULT_SPRITES_API_TIMEOUT_MS = 10_000;
const CHECKPOINT_CREATE_TIMEOUT_MS = 60_000;

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

export interface SpriteCheckpointCreateEvent {
  type: string;
  data?: string;
  error?: string;
  time?: string;
}

export interface SpriteCheckpointCreateResult {
  events: SpriteCheckpointCreateEvent[];
  message: string;
  checkpointId: string | null;
}

export interface SpriteCommandError {
  message: string;
  hint: string;
}

export type SpriteDataSource = SpriteAuthSource;

export interface DashboardSprite extends SpriteSummary {
  checkpoints: SpriteCheckpoint[];
  checkpointCountLoaded: boolean;
  sleep: SleepInference;
  health: HealthCheckResult;
  checkpointError?: string;
}

export interface DashboardData {
  ok: boolean;
  source: SpriteDataSource | null;
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
  costExposure: CostExposureSummary | null;
  auth: SpriteAuthStatus;
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

export interface SpriteStatusGroup<T extends Pick<SpriteSummary, "status">> {
  key: "running" | "warm" | "cold" | "other";
  label: string;
  detail: string;
  sprites: T[];
}

async function runSpriteApi<T>(path: string): Promise<T> {
  const auth = getSpriteAuthConfig();
  if (auth.source === "connector" && auth.gatewayBaseUrl) {
    return runSpriteApiWithGateway<T>(path, auth.gatewayBaseUrl);
  }

  if (
    (auth.source === "token" || auth.source === "saved-token") &&
    auth.token
  ) {
    return runSpriteApiWithToken<T>(path, auth.token);
  }

  const { stdout } = await execFileAsync("sprite", ["api", path], {
    maxBuffer: 1024 * 1024 * 5,
  });
  return parseSpriteApiJson<T>(stdout);
}

async function runSpriteApiText(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const auth = getSpriteAuthConfig();
  if (auth.source === "connector" && auth.gatewayBaseUrl) {
    return runSpriteApiTextWithGateway(path, auth.gatewayBaseUrl, options);
  }

  if (
    (auth.source === "token" || auth.source === "saved-token") &&
    auth.token
  ) {
    return runSpriteApiTextWithToken(path, auth.token, options);
  }

  const args = ["api", path];
  if (options.method && options.method !== "GET") {
    args.push("-X", options.method);
  }
  if (options.body !== undefined) {
    args.push(
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(options.body)
    );
  }

  const { stdout } = await execFileAsync("sprite", args, {
    maxBuffer: 1024 * 1024 * 5,
  });
  return stdout;
}

async function runSpriteApiWithGateway<T>(
  path: string,
  gatewayBaseUrl: string
): Promise<T> {
  const url = createSpriteGatewayUrl(path, gatewayBaseUrl);
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(formatSpriteApiError(res.status, res.statusText, text));
  }

  return JSON.parse(text) as T;
}

async function runSpriteApiTextWithGateway(
  path: string,
  gatewayBaseUrl: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  }
): Promise<string> {
  const url = createSpriteGatewayUrl(path, gatewayBaseUrl);
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: createSpriteApiRequestHeaders(options.body !== undefined),
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_SPRITES_API_TIMEOUT_MS
    ),
  });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(formatSpriteApiError(res.status, res.statusText, text));
  }

  return text;
}

async function runSpriteApiWithToken<T>(
  path: string,
  token: string
): Promise<T> {
  const baseUrl =
    process.env.SPRITES_API_BASE_URL?.trim() || DEFAULT_SPRITES_API_BASE_URL;
  const url = createSpriteApiUrl(path, baseUrl);
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(formatSpriteApiError(res.status, res.statusText, text));
  }

  return JSON.parse(text) as T;
}

async function runSpriteApiTextWithToken(
  path: string,
  token: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  }
): Promise<string> {
  const baseUrl =
    process.env.SPRITES_API_BASE_URL?.trim() || DEFAULT_SPRITES_API_BASE_URL;
  const url = createSpriteApiUrl(path, baseUrl);
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...createSpriteApiRequestHeaders(options.body !== undefined),
      authorization: `Bearer ${token}`,
    },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_SPRITES_API_TIMEOUT_MS
    ),
  });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(formatSpriteApiError(res.status, res.statusText, text));
  }

  return text;
}

function createSpriteApiRequestHeaders(hasJsonBody: boolean) {
  const headers: Record<string, string> = {
    accept: "application/x-ndjson, application/json",
  };

  if (hasJsonBody) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

export function createSpriteApiUrl(path: string, baseUrl: string): URL {
  return new URL(path, baseUrl);
}

export function createSpriteGatewayUrl(path: string, gatewayBaseUrl: string): URL {
  const cleanBase = gatewayBaseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return new URL(`${cleanBase}/${cleanPath}`);
}

export function getSpriteDashboardUrl(
  sprite: Pick<SpriteSummary, "name" | "organization">
): string {
  const url = new URL(
    `/account/${encodeURIComponent(sprite.organization)}`,
    "https://sprites.dev"
  );
  url.searchParams.set("sprite", sprite.name);
  return url.toString();
}

export function formatSpriteApiError(
  status: number,
  statusText: string,
  text: string
): string {
  return `Sprites API request failed (${status} ${statusText}): ${formatApiError(text)}`;
}

export function formatApiError(text: string): string {
  if (!text) return "No response body";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Fall through to the raw response preview.
  }
  return text.slice(0, 240);
}

export function parseSpriteApiJson<T>(output: string): T {
  const start = output.search(/[\[{]/);
  if (start === -1) {
    throw new Error(`Sprite API returned no JSON: ${output.slice(0, 200)}`);
  }
  return JSON.parse(output.slice(start)) as T;
}

export function validateSpriteNameInput(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Sprite name must be a string.");
  }

  const spriteName = value.trim();
  if (!spriteName) {
    throw new Error("Sprite name is required.");
  }
  if (spriteName.length > 128) {
    throw new Error("Sprite name is too long.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(spriteName)) {
    throw new Error("Sprite name contains unsupported characters.");
  }

  return spriteName;
}

export function validateCheckpointCommentInput(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Checkpoint comment must be a string.");
  }

  const comment = value.trim();
  if (!comment) {
    return undefined;
  }
  if (comment.length > 240) {
    throw new Error("Checkpoint comment must be 240 characters or fewer.");
  }
  if (/[\r\n]/.test(comment)) {
    throw new Error("Checkpoint comment must be a single line.");
  }

  return comment;
}

export function parseCheckpointCreateEvents(
  output: string
): SpriteCheckpointCreateEvent[] {
  const start = output.search(/[\[{]/);
  if (start === -1) return [];

  const text = output.slice(start).trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(isCheckpointCreateEvent)
        : [];
    } catch {
      // Fall through to line-by-line parsing.
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const objectStart = line.indexOf("{");
      if (objectStart === -1) return [];

      try {
        const parsed = JSON.parse(line.slice(objectStart)) as unknown;
        return isCheckpointCreateEvent(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export async function createSpriteCheckpoint(
  spriteNameInput: unknown,
  commentInput?: unknown
): Promise<SpriteCheckpointCreateResult> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const comment = validateCheckpointCommentInput(commentInput);
  const output = await runSpriteApiText(
    `/v1/sprites/${encodeURIComponent(spriteName)}/checkpoint`,
    {
      method: "POST",
      body: comment ? { comment } : {},
      timeoutMs: CHECKPOINT_CREATE_TIMEOUT_MS,
    }
  );
  const events = parseCheckpointCreateEvents(output);

  if (events.length === 0) {
    throw new Error("Sprites API did not return checkpoint progress.");
  }

  const errorEvent = events.find((event) => event.type === "error");
  if (errorEvent) {
    throw new Error(
      errorEvent.error || errorEvent.data || "Checkpoint creation failed."
    );
  }

  const completeEvent = [...events]
    .reverse()
    .find((event) => event.type === "complete");
  const message =
    completeEvent?.data ||
    [...events].reverse().find((event) => event.data)?.data ||
    "Checkpoint created.";

  return {
    events,
    message,
    checkpointId: parseCheckpointId(message),
  };
}

function isCheckpointCreateEvent(
  value: unknown
): value is SpriteCheckpointCreateEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpriteCheckpointCreateEvent>;
  return typeof candidate.type === "string";
}

function parseCheckpointId(message: string): string | null {
  const match = message.match(/\b(v\d+)\b/i);
  return match?.[1] ?? null;
}

export async function getDashboardData(
  checkpointSpriteName?: string | null
): Promise<DashboardData> {
  const fetchedAtDate = new Date();
  const fetchedAt = fetchedAtDate.toISOString();
  const source = getSpriteDataSource();
  const auth = getSpriteAuthStatus();
  try {
    const list = await runSpriteApi<SpriteListResponse>("/v1/sprites/");
    const selectedCheckpointSpriteName =
      list.sprites.find((sprite) => sprite.name === checkpointSpriteName)?.name ??
      list.sprites[0]?.name ??
      null;
    const sprites = await Promise.all(
      list.sprites.map(async (sprite) => {
        const checkpointRequest: Promise<{
          items: SpriteCheckpoint[];
          error?: string;
        }> =
          sprite.name === selectedCheckpointSpriteName
            ? getCheckpoints(sprite.name)
            : Promise.resolve({ items: [] });
        const [checkpoints, health] = await Promise.all([
          checkpointRequest,
          checkSpriteHealth(sprite),
        ]);

        return {
          ...sprite,
          checkpoints: checkpoints.items,
          checkpointCountLoaded: sprite.name === selectedCheckpointSpriteName,
          checkpointError: checkpoints.error,
          health,
          sleep: inferSleep(sprite, health),
        };
      })
    );
    const costExposure = await observeCostExposure({
      sprites,
      source,
      observedAt: fetchedAtDate,
    });

    return {
      ok: true,
      source,
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
      costExposure,
      auth,
      fetchedAt,
    };
  } catch (err) {
    return {
      ok: false,
      source,
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
      costExposure: buildCostExposureSummary({
        observations: [],
        currentObservations: [],
        now: fetchedAtDate,
        writeError: null,
      }),
      auth,
      fetchedAt,
      error: {
        message: err instanceof Error ? err.message : String(err),
        hint: getSetupHint(source),
      },
    };
  }
}

export function getSpriteDataSource(): SpriteDataSource {
  return getSpriteAuthConfig().source;
}

export async function validateSpritesApiToken(token: string): Promise<void> {
  await runSpriteApiWithToken<SpriteListResponse>("/v1/sprites/", token);
}

export function selectDashboardSprite(
  sprites: DashboardSprite[],
  requestedName: string | null
): DashboardSprite | null {
  if (sprites.length === 0) return null;
  if (!requestedName) return sprites[0];
  return (
    sprites.find((sprite) => sprite.name === requestedName) ?? sprites[0]
  );
}

export function getSpriteStatusGroups<T extends Pick<SpriteSummary, "status">>(
  sprites: T[]
): SpriteStatusGroup<T>[] {
  const running: T[] = [];
  const warm: T[] = [];
  const cold: T[] = [];
  const other: T[] = [];

  for (const sprite of sprites) {
    if (sprite.status === "running") {
      running.push(sprite);
    } else if (sprite.status === "warm") {
      warm.push(sprite);
    } else if (sprite.status === "cold") {
      cold.push(sprite);
    } else {
      other.push(sprite);
    }
  }

  const groups: SpriteStatusGroup<T>[] = [
    {
      key: "running",
      label: "Running",
      detail: "Active now",
      sprites: running,
    },
    {
      key: "warm",
      label: "Warm",
      detail: "Recently touched",
      sprites: warm,
    },
    {
      key: "cold",
      label: "Cold",
      detail: "Idle or asleep",
      sprites: cold,
    },
    {
      key: "other",
      label: "Other",
      detail: "Unknown status",
      sprites: other,
    },
  ];

  return groups.filter((group) => group.sprites.length > 0);
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

function getSetupHint(source: SpriteDataSource): string {
  if (source === "connector") {
    return "Check `SPRITES_API_GATEWAY_BASE_URL`, then confirm the connector access policy grants this Sprite access to the Sprites API connector.";
  }

  if (source === "token") {
    return "Check `SPRITES_API_TOKEN` on the server. It must stay server-only and must not use `NEXT_PUBLIC_`.";
  }

  if (source === "saved-token") {
    return "The saved fallback token did not work. Replace or delete it from the setup panel, then prefer a Sprites Connector for long-term use.";
  }

  return `No server credential is configured. Recommended: use a Sprites Connector. Current source: ${getAuthSourceLabel(source)}.`;
}
