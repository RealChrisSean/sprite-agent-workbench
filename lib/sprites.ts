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
  readCostExposure,
  type CostExposureSummary,
} from "./cost-ledger";
import {
  buildCheckpointObservedEventInput,
  getLinkedCheckpointIds,
  readAgentRunEventsForSprite,
  recordAgentRunEvent,
} from "./agent-runs";
import {
  getHealthWithoutProbe,
  probePublicSpriteHealth,
  readLatestHealthProbes,
  recordHealthProbe,
  type HealthCheckResult,
  type HealthProbeRecord,
} from "./health-probes";

const execFileAsync = promisify(execFile);
const DEFAULT_SPRITES_API_BASE_URL = "https://api.sprites.dev";
const DEFAULT_SPRITES_API_TIMEOUT_MS = 10_000;
const CHECKPOINT_CREATE_TIMEOUT_MS = 60_000;
const CHECKPOINT_RESTORE_TIMEOUT_MS = 60_000;

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

export interface SpriteCheckpointRestoreResult {
  events: SpriteCheckpointCreateEvent[];
  message: string;
  checkpointId: string;
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

export interface SpriteStatusGroup<T extends Pick<SpriteSummary, "status">> {
  key: "running" | "warm" | "cold" | "other";
  label: string;
  detail: string;
  sprites: T[];
}

export interface SpriteRuntimeService {
  name: string;
  command: string;
  state: string;
  pid: number | null;
  httpPort: number | null;
  startedAt: string | null;
  keepaliveNamed: boolean;
}

export interface SpriteExecSession {
  id: string;
  command: string;
  active: boolean;
  createdAt: string | null;
  lastActivityAt: string | null;
  workdir: string | null;
}

export interface SpriteRuntimeEvidence {
  spriteName: string;
  services: SpriteRuntimeService[];
  sessions: SpriteExecSession[];
  activeSessionCount: number;
  runningServiceCount: number;
  assessment: {
    label: string;
    tone: "good" | "warn" | "neutral";
    detail: string;
  };
  errors: string[];
  fetchedAt: string;
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

export function validateCheckpointIdInput(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Checkpoint id must be a string.");
  }

  const checkpointId = value.trim();
  if (!checkpointId) {
    throw new Error("Checkpoint id is required.");
  }
  if (checkpointId.length > 128) {
    throw new Error("Checkpoint id is too long.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(checkpointId)) {
    throw new Error("Checkpoint id contains unsupported characters.");
  }

  return checkpointId;
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

export async function restoreSpriteCheckpoint(
  spriteNameInput: unknown,
  checkpointIdInput: unknown
): Promise<SpriteCheckpointRestoreResult> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const checkpointId = validateCheckpointIdInput(checkpointIdInput);
  const output = await runSpriteApiText(
    `/v1/sprites/${encodeURIComponent(spriteName)}/checkpoints/${encodeURIComponent(
      checkpointId
    )}/restore`,
    {
      method: "POST",
      timeoutMs: CHECKPOINT_RESTORE_TIMEOUT_MS,
    }
  );
  const events = parseCheckpointCreateEvents(output);

  if (events.length === 0) {
    throw new Error("Sprites API did not return restore progress.");
  }

  const errorEvent = events.find((event) => event.type === "error");
  if (errorEvent) {
    throw new Error(
      errorEvent.error || errorEvent.data || "Checkpoint restore failed."
    );
  }

  const completeEvent = [...events]
    .reverse()
    .find((event) => event.type === "complete");
  const message =
    completeEvent?.data ||
    [...events].reverse().find((event) => event.data)?.data ||
    `Restored to ${checkpointId}.`;

  return {
    events,
    message,
    checkpointId,
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

// The Sprites control plane only counts interactive sessions as activity, so
// the Sprite hosting this app can be reported cold while it is serving the
// very page being viewed. Detect that case from the request host so the
// dashboard can tell the truth about itself.
export function isSelfSprite(
  sprite: { url: string | null },
  selfHost: string | null | undefined
): boolean {
  if (!selfHost || !sprite.url) return false;
  try {
    return new URL(sprite.url).host.toLowerCase() === selfHost.toLowerCase();
  } catch {
    return false;
  }
}

export async function getDashboardData(
  checkpointSpriteName?: string | null,
  options?: { loadCheckpoints?: boolean; selfHost?: string | null }
): Promise<DashboardData> {
  const fetchedAtDate = new Date();
  const fetchedAt = fetchedAtDate.toISOString();
  const source = getSpriteDataSource();
  const auth = getSpriteAuthStatus();
  const loadCheckpoints = options?.loadCheckpoints ?? true;
  try {
    const list = await runSpriteApi<SpriteListResponse>("/v1/sprites/");
    const latestHealthProbes = await readLatestHealthProbes().catch(
      () => new Map<string, HealthProbeRecord>()
    );
    const selectedCheckpointSpriteName = loadCheckpoints
      ? (list.sprites.find((sprite) => sprite.name === checkpointSpriteName)
          ?.name ??
        list.sprites[0]?.name ??
        null)
      : null;
    const sprites = await Promise.all(
      list.sprites.map(async (sprite) => {
        const checkpointRequest: Promise<{
          items: SpriteCheckpoint[];
          error?: string;
        }> =
          sprite.name === selectedCheckpointSpriteName
            ? getCheckpoints(sprite.name)
            : Promise.resolve({ items: [] });
        const checkpoints = await checkpointRequest;
        const health = resolveStoredHealth(
          sprite,
          latestHealthProbes.get(sprite.name)
        );
        const servingThisPage = isSelfSprite(sprite, options?.selfHost);

        return {
          ...sprite,
          // Serving this page load is proof of activity, whatever the
          // control plane says.
          status: servingThisPage ? "running" : sprite.status,
          checkpoints: checkpoints.items,
          checkpointCountLoaded: sprite.name === selectedCheckpointSpriteName,
          checkpointError: checkpoints.error,
          health,
          sleep: inferSleep(sprite, health, { servingThisPage }),
        };
      })
    );
    const promotedFrom = list.sprites
      .filter(
        (sprite) =>
          isSelfSprite(sprite, options?.selfHost) && sprite.status !== "running"
      )
      .map((sprite) => sprite.status);
    const costExposure = await readCostExposure({
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
        running: list.running + promotedFrom.length,
        warm: list.warm - promotedFrom.filter((s) => s === "warm").length,
        cold: list.cold - promotedFrom.filter((s) => s === "cold").length,
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

export interface FleetObservationResult {
  observedAt: string;
  spriteCount: number;
  observationCount: number;
  checkpointEventsRecorded: number;
  warnings: string[];
}

/**
 * Explicitly collect control-plane state into the local ledgers. Unlike a page
 * render, this function is expected to write observations and checkpoint
 * discovery events. It never requests a Sprite's public app URL.
 */
export async function observeSpriteFleet(
  observedAt = new Date()
): Promise<FleetObservationResult> {
  const source = getSpriteDataSource();
  const list = await runSpriteApi<SpriteListResponse>("/v1/sprites/");
  const latestHealthProbes = await readLatestHealthProbes().catch(
    () => new Map<string, HealthProbeRecord>()
  );
  const sprites = await Promise.all(
    list.sprites.map(async (sprite): Promise<DashboardSprite> => {
      const checkpoints = await getCheckpoints(sprite.name);
      const health = resolveStoredHealth(
        sprite,
        latestHealthProbes.get(sprite.name)
      );
      return {
        ...sprite,
        checkpoints: checkpoints.items,
        checkpointCountLoaded: true,
        checkpointError: checkpoints.error,
        health,
        sleep: inferSleep(sprite, health),
      };
    })
  );
  const exposure = await observeCostExposure({
    sprites,
    source: `collector:${source}`,
    observedAt,
  });
  const warnings: string[] = [];
  if (exposure.writeError) warnings.push(exposure.writeError);

  let checkpointEventsRecorded = 0;
  for (const sprite of sprites) {
    if (sprite.checkpointError) {
      warnings.push(`${sprite.name}: ${sprite.checkpointError}`);
      continue;
    }
    try {
      checkpointEventsRecorded += await recordObservedCheckpoints(
        sprite,
        observedAt
      );
    } catch (err) {
      warnings.push(
        `${sprite.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    observedAt: observedAt.toISOString(),
    spriteCount: sprites.length,
    observationCount: sprites.length,
    checkpointEventsRecorded,
    warnings,
  };
}

export async function runSpriteHealthProbe({
  spriteName: spriteNameInput,
  path,
  expectedStatuses,
  now = new Date(),
}: {
  spriteName: unknown;
  path?: unknown;
  expectedStatuses?: unknown;
  now?: Date;
}): Promise<HealthProbeRecord> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const list = await runSpriteApi<SpriteListResponse>("/v1/sprites/");
  const sprite = list.sprites.find((item) => item.name === spriteName);
  if (!sprite) throw new Error(`Sprite '${spriteName}' was not found.`);

  const result = await probePublicSpriteHealth({
    spriteName,
    spriteUrl: sprite.url,
    urlAuth: sprite.url_settings?.auth,
    path,
    expectedStatuses,
    now,
  });
  await recordHealthProbe(result);
  return result;
}

export async function getSpriteRuntimeEvidence(
  spriteNameInput: unknown,
  now = new Date()
): Promise<SpriteRuntimeEvidence> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const [servicesResult, sessionsResult] = await Promise.allSettled([
    runSpriteApi<unknown>(
      `/v1/sprites/${encodeURIComponent(spriteName)}/services`
    ),
    runSpriteApi<unknown>(`/v1/sprites/${encodeURIComponent(spriteName)}/exec`),
  ]);
  const errors: string[] = [];
  const services =
    servicesResult.status === "fulfilled"
      ? parseSpriteServices(servicesResult.value)
      : [];
  const sessions =
    sessionsResult.status === "fulfilled"
      ? parseSpriteExecSessions(sessionsResult.value)
      : [];

  if (servicesResult.status === "rejected") {
    errors.push(
      `Services: ${servicesResult.reason instanceof Error ? servicesResult.reason.message : String(servicesResult.reason)}`
    );
  }
  if (sessionsResult.status === "rejected") {
    errors.push(
      `Exec sessions: ${sessionsResult.reason instanceof Error ? sessionsResult.reason.message : String(sessionsResult.reason)}`
    );
  }

  const activeSessionCount = sessions.filter((session) => session.active).length;
  const runningServices = services.filter(
    (service) => service.state === "running"
  );
  const keepaliveServices = runningServices.filter(
    (service) => service.keepaliveNamed
  );
  const assessment =
    activeSessionCount > 0
      ? {
          label: "Active exec session present",
          tone: "warn" as const,
          detail: `${activeSessionCount} active exec session${activeSessionCount === 1 ? " is" : "s are"} direct control-plane evidence of current activity.`,
        }
      : keepaliveServices.length > 0
        ? {
            label: "Keepalive service present",
            tone: "warn" as const,
            detail:
              "A running keepalive-named service is strong evidence of intentional activity, but metadata alone cannot prove what the process is doing.",
          }
        : runningServices.length > 0
          ? {
              label: "Running services present",
              tone: "neutral" as const,
              detail:
                "Service state alone does not prove a keep-awake cause; the process must still maintain activity or an open connection.",
            }
          : {
              label: "No direct keep-awake evidence",
              tone: "good" as const,
              detail:
                "No active exec sessions or running Services were visible in these control-plane endpoints.",
            };

  return {
    spriteName,
    services,
    sessions,
    activeSessionCount,
    runningServiceCount: runningServices.length,
    assessment,
    errors,
    fetchedAt: now.toISOString(),
  };
}

export function parseSpriteServices(value: unknown): SpriteRuntimeService[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return [];
    const state = isRecord(entry.state) ? entry.state : {};
    const args = Array.isArray(entry.args)
      ? entry.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const command = sanitizeRuntimeCommand(
      typeof entry.cmd === "string" ? entry.cmd : "",
      args
    );
    const name = entry.name.slice(0, 160);
    return [
      {
        name,
        command,
        state:
          typeof state.status === "string" ? state.status : "unknown",
        pid: typeof state.pid === "number" ? state.pid : null,
        httpPort:
          typeof entry.http_port === "number" ? entry.http_port : null,
        startedAt:
          typeof state.started_at === "string" ? state.started_at : null,
        keepaliveNamed: /keep[-_ ]?alive|heartbeat/i.test(
          `${name} ${command}`
        ),
      },
    ];
  });
}

export function parseSpriteExecSessions(value: unknown): SpriteExecSession[] {
  const sessions = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  return sessions.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    return [
      {
        id: entry.id.slice(0, 160),
        command: sanitizeRuntimeCommand(
          typeof entry.command === "string" ? entry.command : "",
          []
        ),
        active: entry.is_active === true,
        createdAt: typeof entry.created === "string" ? entry.created : null,
        lastActivityAt:
          typeof entry.last_activity === "string" ? entry.last_activity : null,
        workdir: typeof entry.workdir === "string" ? entry.workdir : null,
      },
    ];
  });
}

export function isRestorableCheckpoint(
  checkpoint: Pick<SpriteCheckpoint, "id">
): boolean {
  return checkpoint.id.toLowerCase() !== "current";
}

function sanitizeRuntimeCommand(command: string, args: string[]): string {
  const secretFlag = /(?:token|secret|password|api[-_]?key)/i;
  const parts = [command, ...args].slice(0, 32);
  let redactNext = false;
  return parts
    .map((part) => {
      if (redactNext) {
        redactNext = false;
        return "[redacted]";
      }
      if (part.startsWith("-") && secretFlag.test(part)) {
        redactNext = !part.includes("=");
        return part.includes("=")
          ? `${part.slice(0, part.indexOf("=") + 1)}[redacted]`
          : part;
      }
      if (/^[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)=/i.test(part)) {
        return `${part.slice(0, part.indexOf("=") + 1)}[redacted]`;
      }
      return part;
    })
    .join(" ")
    .slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Read a generous window so an old checkpoint's linked events don't age out
// and cause a duplicate observed event on a later refresh.
const OBSERVED_LINK_LOOKBACK = 1000;

async function recordObservedCheckpoints(
  sprite: DashboardSprite,
  observedAt: Date
): Promise<number> {
  if (sprite.checkpointError || sprite.checkpoints.length === 0) return 0;

  const events = await readAgentRunEventsForSprite(
    sprite.name,
    OBSERVED_LINK_LOOKBACK
  );
  const linked = getLinkedCheckpointIds(events);

  let recorded = 0;
  for (const checkpoint of sprite.checkpoints) {
    if (!isRestorableCheckpoint(checkpoint)) continue;
    if (linked.has(checkpoint.id)) continue;
    await recordAgentRunEvent(
      buildCheckpointObservedEventInput({
        spriteName: sprite.name,
        checkpointId: checkpoint.id,
        checkpointCreatedAt: checkpoint.create_time,
        observedAt: observedAt.toISOString(),
        comment: checkpoint.comment ?? null,
      }),
      observedAt
    );
    linked.add(checkpoint.id);
    recorded += 1;
  }
  return recorded;
}

export function getSpriteDataSource(): SpriteDataSource {
  return getSpriteAuthConfig().source;
}

export async function validateSpritesApiToken(token: string): Promise<void> {
  await runSpriteApiWithToken<SpriteListResponse>("/v1/sprites/", token);
}

export interface SpriteConnectionTestResult {
  source: SpriteDataSource;
  orgName: string | null;
  total: number;
}

export async function testSpriteConnection(): Promise<SpriteConnectionTestResult> {
  const source = getSpriteDataSource();
  const list = await runSpriteApi<SpriteListResponse>("/v1/sprites/");
  return {
    source,
    orgName: list.name,
    total: list.sprites.length,
  };
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
      detail: "Suspended, fast resume",
      sprites: warm,
    },
    {
      key: "cold",
      label: "Cold",
      detail: "Fully stopped",
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

function resolveStoredHealth(
  sprite: SpriteSummary,
  stored: HealthProbeRecord | undefined
): HealthCheckResult {
  if (!sprite.url || sprite.url_settings?.auth !== "public") {
    return getHealthWithoutProbe({
      url: sprite.url,
      urlAuth: sprite.url_settings?.auth,
    });
  }
  return (
    stored ??
    getHealthWithoutProbe({
      url: sprite.url,
      urlAuth: sprite.url_settings?.auth,
    })
  );
}

function inferSleep(
  sprite: SpriteSummary,
  health: HealthCheckResult,
  options?: { servingThisPage?: boolean }
): SleepInference {
  const evidence: string[] = [];
  const lastRunning = formatRelativeTime(sprite.last_running_at);
  const lastWarming = formatRelativeTime(sprite.last_warming_at);

  if (lastRunning) evidence.push(`Last running: ${lastRunning}`);
  if (lastWarming) evidence.push(`Last warming: ${lastWarming}`);
  evidence.push(`URL auth: ${sprite.url_settings?.auth || "unknown"}`);
  evidence.push(`Health: ${health.label}`);

  if (options?.servingThisPage) {
    return {
      label: "Active now — serving this dashboard",
      tone: "good",
      evidence: [
        "This Sprite served the page you are viewing right now, which is direct proof it is awake.",
        sprite.status !== "running"
          ? `The control plane reported "${sprite.status}" because edge HTTP traffic does not count as a session; the Workbench corrected it with first-hand evidence.`
          : "Sprites also reports this environment is running.",
        ...evidence,
      ],
    };
  }

  if (sprite.status === "running") {
    return {
      label: "Active now",
      tone: "good",
      evidence: ["Sprites reports this environment is running.", ...evidence],
    };
  }

  if (sprite.status === "warm") {
    return {
      label: "Warm / suspended, fast resume",
      tone: "good",
      evidence: [
        "Sprites reports this environment is warm: activity stopped, the VM is suspended with memory frozen in place, and compute billing is stopped.",
        "The next request resumes it in about 100-500ms, with processes picking up exactly where they were.",
        ...evidence,
      ],
    };
  }

  if (sprite.status === "cold") {
    return {
      label: "Fully stopped",
      tone: "warn",
      evidence: [
        "Sprites reports this environment is cold: it idled past the warm stage, so the VM is fully stopped and in-memory state was dropped.",
        "Nothing woke it in time - no session, command, or URL traffic during the warm window. The next wake takes about 1-2s and starts processes fresh.",
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
