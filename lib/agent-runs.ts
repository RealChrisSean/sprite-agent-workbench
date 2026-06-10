import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactSecretLikePath } from "./path-redaction";
import { validateSpriteNameInput } from "./sprites";

export const AGENT_RUN_EVENT_TYPES = [
  "run_started",
  "checkpoint_created",
  "restore_performed",
  "command_started",
  "command_finished",
  "file_changed",
  "run_failed",
  "run_completed",
] as const;

export const AGENT_RUN_EVENT_STATUSES = [
  "info",
  "success",
  "warning",
  "error",
] as const;

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];
export type AgentRunEventStatus = (typeof AGENT_RUN_EVENT_STATUSES)[number];
export type AgentRunEventMetadata = Record<
  string,
  string | number | boolean | null
>;
export type AgentRunFileStatus = "A" | "M" | "D";

export const AGENT_RUN_EVENT_TYPE_LABELS: Record<AgentRunEventType, string> = {
  run_started: "Run started",
  checkpoint_created: "Checkpoint created",
  restore_performed: "Restore performed",
  command_started: "Command started",
  command_finished: "Command finished",
  file_changed: "File changed",
  run_failed: "Run failed",
  run_completed: "Run completed",
};

export interface AgentRunEventInput {
  spriteName?: unknown;
  type?: unknown;
  runId?: unknown;
  label?: unknown;
  summary?: unknown;
  status?: unknown;
  metadata?: unknown;
  files?: unknown;
  diffStat?: unknown;
}

export interface AgentRunChangedFile {
  path: string;
  status: AgentRunFileStatus;
  redacted: boolean;
}

export interface AgentRunFileChange {
  files: AgentRunChangedFile[];
  fileCount: number;
  redactedCount: number;
  diffStat: string | null;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  spriteName: string;
  type: AgentRunEventType;
  label: string;
  summary: string | null;
  status: AgentRunEventStatus;
  metadata: AgentRunEventMetadata;
  fileChange?: AgentRunFileChange | null;
  createdAt: string;
}

export interface AgentRunGroup {
  runId: string;
  spriteName: string;
  status: AgentRunEventStatus;
  startedAt: string;
  updatedAt: string;
  title: string;
  events: AgentRunEvent[];
}

export interface AgentRunTimeline {
  spriteName: string;
  events: AgentRunEvent[];
  runs: AgentRunGroup[];
}

const DEFAULT_EVENT_LIMIT = 60;
const MAX_FILE_CHANGE_ENTRIES = 200;
const MAX_FILE_PATH_LENGTH = 300;
const SECRET_VALUE_PATTERN =
  /\b(?:bearer\s+\S+|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*\S+)/i;
const DEFAULT_RUN_EVENTS_PATH = join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".workbench-state",
  "run-events.jsonl"
);

export function getAgentRunEventsPath(): string {
  const explicitPath = process.env.SPRITE_AGENT_WORKBENCH_RUN_EVENTS_PATH?.trim();
  return explicitPath || DEFAULT_RUN_EVENTS_PATH;
}

export async function recordAgentRunEvent(
  input: AgentRunEventInput,
  now = new Date()
): Promise<AgentRunEvent> {
  const event = validateAgentRunEventInput(input, now);
  const path = getAgentRunEventsPath();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return event;
}

export async function getAgentRunTimeline(
  spriteNameInput: unknown,
  limit = DEFAULT_EVENT_LIMIT
): Promise<AgentRunTimeline> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const events = await readAgentRunEventsForSprite(spriteName, limit);

  return {
    spriteName,
    events,
    runs: groupAgentRunEvents(events),
  };
}

export async function readAgentRunEventsForSprite(
  spriteNameInput: unknown,
  limit = DEFAULT_EVENT_LIMIT
): Promise<AgentRunEvent[]> {
  const spriteName = validateSpriteNameInput(spriteNameInput);
  const path = getAgentRunEventsPath();
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
        return isAgentRunEvent(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .filter((event) => event.spriteName === spriteName)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export function validateAgentRunEventInput(
  input: AgentRunEventInput,
  now = new Date()
): AgentRunEvent {
  const spriteName = validateSpriteNameInput(input.spriteName);
  const type = validateEventType(input.type);
  const label =
    validateBoundedText(input.label, "Event label", 120) ??
    getDefaultEventLabel(type);
  const summary =
    validateBoundedText(input.summary, "Event summary", 500) ?? null;
  const status =
    input.status === undefined || input.status === null || input.status === ""
      ? getDefaultEventStatus(type)
      : validateEventStatus(input.status);
  const runId = validateRunId(input.runId) ?? createRunId(now);
  const metadata = validateMetadata(input.metadata);
  const fileChange = validateFileChangeInput(type, input.files, input.diffStat);

  return {
    id: crypto.randomUUID(),
    runId,
    spriteName,
    type,
    label,
    summary,
    status,
    metadata,
    fileChange,
    createdAt: now.toISOString(),
  };
}

export function groupAgentRunEvents(events: AgentRunEvent[]): AgentRunGroup[] {
  const groups = new Map<string, AgentRunEvent[]>();

  for (const event of events) {
    groups.set(event.runId, [...(groups.get(event.runId) ?? []), event]);
  }

  return [...groups.entries()]
    .map(([runId, runEvents]) => {
      const sorted = [...runEvents].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
      const latest = sorted[sorted.length - 1];
      const first = sorted[0];
      const title =
        sorted.find((event) => event.type === "run_started")?.label ||
        first.label;

      return {
        runId,
        spriteName: first.spriteName,
        status: latest.status,
        startedAt: first.createdAt,
        updatedAt: latest.createdAt,
        title,
        events: sorted,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getCheckpointContextEvents(
  events: AgentRunEvent[],
  checkpointId: string,
  limit = 4
): AgentRunEvent[] {
  return events
    .filter((event) => event.metadata.checkpoint_id === checkpointId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export function buildCheckpointCreatedEventInput({
  spriteName,
  checkpointId,
  comment,
  message,
}: {
  spriteName: string;
  checkpointId: string | null;
  comment?: string | null;
  message?: string | null;
}): AgentRunEventInput {
  const label = checkpointId
    ? `Checkpoint ${checkpointId} created`
    : "Checkpoint created";
  const normalizedComment = comment?.trim();

  return {
    spriteName,
    type: "checkpoint_created",
    label,
    summary: normalizedComment
      ? "Created from Sprite Agent Workbench with a checkpoint comment."
      : message || "Created from Sprite Agent Workbench.",
    status: "success",
    metadata: {
      checkpoint_id: checkpointId || "unknown",
      source: "workbench",
      has_comment: Boolean(normalizedComment),
    },
  };
}

export function buildRestorePerformedEventInput({
  spriteName,
  checkpointId,
  message,
}: {
  spriteName: string;
  checkpointId: string;
  message?: string | null;
}): AgentRunEventInput {
  return {
    spriteName,
    type: "restore_performed",
    label: `Restored to ${checkpointId}`,
    summary: message || "Restored from Sprite Agent Workbench.",
    status: "warning",
    metadata: {
      checkpoint_id: checkpointId,
      restored_checkpoint_id: checkpointId,
      source: "workbench",
    },
  };
}

function validateEventType(value: unknown): AgentRunEventType {
  if (typeof value !== "string") {
    throw new Error("Event type is required.");
  }
  if (!AGENT_RUN_EVENT_TYPES.includes(value as AgentRunEventType)) {
    throw new Error(`Unsupported event type: ${value}`);
  }
  return value as AgentRunEventType;
}

function validateEventStatus(value: unknown): AgentRunEventStatus {
  if (typeof value !== "string") {
    throw new Error("Event status must be a string.");
  }
  if (!AGENT_RUN_EVENT_STATUSES.includes(value as AgentRunEventStatus)) {
    throw new Error(`Unsupported event status: ${value}`);
  }
  return value as AgentRunEventStatus;
}

function validateRunId(value: unknown): string | undefined {
  const runId = validateBoundedText(value, "Run id", 96);
  if (runId === undefined) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(runId)) {
    throw new Error(
      "Run id must start with a letter or number and use only letters, numbers, dots, colons, underscores, or dashes."
    );
  }
  return runId;
}

function validateBoundedText(
  value: unknown,
  label: string,
  maxLength: number
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${label} must not contain control characters.`);
  }
  assertNoSecretLookingText(text, label);

  return text;
}

function validateMetadata(value: unknown): AgentRunEventMetadata {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw new Error("Event metadata must be an object.");
  }

  const entries = Object.entries(value);
  if (entries.length > 12) {
    throw new Error("Event metadata can include at most 12 fields.");
  }

  const metadata: AgentRunEventMetadata = {};
  for (const [key, rawValue] of entries) {
    const safeKey = validateMetadataKey(key);
    metadata[safeKey] = validateMetadataValue(rawValue, safeKey);
  }

  return metadata;
}

function validateMetadataKey(key: string): string {
  if (!/^[a-zA-Z0-9_.-]{1,48}$/.test(key)) {
    throw new Error(`Invalid metadata key: ${key}`);
  }
  return key;
}

function validateMetadataValue(
  value: unknown,
  key: string
): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Metadata value '${key}' must be finite.`);
    }
    return value;
  }
  if (typeof value === "string") {
    const text = validateBoundedText(value, `Metadata value '${key}'`, 240);
    return text ?? "";
  }

  throw new Error(`Metadata value '${key}' must be a primitive value.`);
}

function validateFileChangeInput(
  type: AgentRunEventType,
  files: unknown,
  diffStat: unknown
): AgentRunFileChange | null {
  if (type !== "file_changed") {
    if (files !== undefined || diffStat !== undefined) {
      throw new Error("File change fields are only valid for file_changed events.");
    }
    return null;
  }

  if (!Array.isArray(files)) {
    throw new Error("File changed events require a files array.");
  }
  if (files.length === 0) {
    throw new Error("File changed events require at least one file.");
  }
  if (files.length > MAX_FILE_CHANGE_ENTRIES) {
    throw new Error(
      `File changed events can include at most ${MAX_FILE_CHANGE_ENTRIES} files.`
    );
  }

  const changedFiles = files.map(validateChangedFileInput);
  const redactedCount = changedFiles.filter((file) => file.redacted).length;
  const safeDiffStat =
    validateBoundedText(diffStat, "Diff stat", 160) ?? null;

  return {
    files: changedFiles,
    fileCount: changedFiles.length,
    redactedCount,
    diffStat: safeDiffStat,
  };
}

function validateChangedFileInput(value: unknown): AgentRunChangedFile {
  if (!isPlainObject(value)) {
    throw new Error("Each changed file must be an object.");
  }

  const status = validateFileStatus(value.status);
  const path = validateFilePath(value.path);
  const redacted = redactSecretLikePath(path);

  return {
    path: redacted.path,
    status,
    redacted: redacted.redacted,
  };
}

function validateFileStatus(value: unknown): AgentRunFileStatus {
  if (typeof value !== "string") {
    throw new Error("Changed file status must be a string.");
  }
  if (value !== "A" && value !== "M" && value !== "D") {
    throw new Error("Changed file status must be A, M, or D.");
  }
  return value;
}

function validateFilePath(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Changed file path must be a string.");
  }

  const path = value.trim().replaceAll("\\", "/");
  if (!path) {
    throw new Error("Changed file path is required.");
  }
  if (path.length > MAX_FILE_PATH_LENGTH) {
    throw new Error(
      `Changed file path must be ${MAX_FILE_PATH_LENGTH} characters or fewer.`
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("Changed file path must not contain control characters.");
  }

  return path;
}

function assertNoSecretLookingText(value: string, label: string): void {
  if (SECRET_VALUE_PATTERN.test(value)) {
    throw new Error(`${label} looks like it may contain a secret.`);
  }
}

function getDefaultEventLabel(type: AgentRunEventType): string {
  return AGENT_RUN_EVENT_TYPE_LABELS[type];
}

function getDefaultEventStatus(type: AgentRunEventType): AgentRunEventStatus {
  if (type === "run_failed") return "error";
  if (
    type === "run_completed" ||
    type === "command_finished" ||
    type === "checkpoint_created"
  ) {
    return "success";
  }
  if (type === "file_changed" || type === "restore_performed") return "warning";
  return "info";
}

function createRunId(now: Date): string {
  return `run-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${crypto
    .randomUUID()
    .slice(0, 8)}`;
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<AgentRunEvent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.spriteName === "string" &&
    typeof candidate.type === "string" &&
    AGENT_RUN_EVENT_TYPES.includes(candidate.type as AgentRunEventType) &&
    typeof candidate.label === "string" &&
    (candidate.summary === null || typeof candidate.summary === "string") &&
    typeof candidate.status === "string" &&
    AGENT_RUN_EVENT_STATUSES.includes(
      candidate.status as AgentRunEventStatus
    ) &&
    isPlainObject(candidate.metadata) &&
    (candidate.fileChange === undefined ||
      candidate.fileChange === null ||
      isAgentRunFileChange(candidate.fileChange)) &&
    typeof candidate.createdAt === "string"
  );
}

function isAgentRunFileChange(value: unknown): value is AgentRunFileChange {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<AgentRunFileChange>;
  return (
    Array.isArray(candidate.files) &&
    candidate.files.every(isAgentRunChangedFile) &&
    typeof candidate.fileCount === "number" &&
    Number.isInteger(candidate.fileCount) &&
    typeof candidate.redactedCount === "number" &&
    Number.isInteger(candidate.redactedCount) &&
    (candidate.diffStat === null || typeof candidate.diffStat === "string")
  );
}

function isAgentRunChangedFile(value: unknown): value is AgentRunChangedFile {
  if (!isPlainObject(value)) return false;
  const candidate = value as Partial<AgentRunChangedFile>;
  return (
    typeof candidate.path === "string" &&
    (candidate.status === "A" ||
      candidate.status === "M" ||
      candidate.status === "D") &&
    typeof candidate.redacted === "boolean"
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
