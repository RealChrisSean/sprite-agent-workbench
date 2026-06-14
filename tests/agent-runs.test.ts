import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createRunEventRoute } from "../app/api/runs/events/route";
import {
  buildCheckpointCreatedEventInput,
  buildRestorePerformedEventInput,
  buildVerificationEventInput,
  getCheckpointContextEvents,
  getEventsSinceCheckpoint,
  getAgentRunTimeline,
  readAgentRunEventsForSprite,
  recordAgentRunEvent,
  validateAgentRunEventInput,
} from "../lib/agent-runs";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent run event storage", () => {
  it("records and reads events for one Sprite without mixing fleets", async () => {
    useRunEventFile();

    await recordAgentRunEvent(
      {
        spriteName: "sprite-agent-workbench",
        runId: "run-1",
        type: "run_started",
        label: "Install dependencies",
        summary: "Agent started from a clean checkpoint.",
      },
      new Date("2026-06-06T12:00:00Z")
    );
    await recordAgentRunEvent(
      {
        spriteName: "recallmem",
        runId: "run-elsewhere",
        type: "run_started",
      },
      new Date("2026-06-06T12:01:00Z")
    );
    await recordAgentRunEvent(
      {
        spriteName: "sprite-agent-workbench",
        runId: "run-1",
        type: "command_finished",
        label: "npm test passed",
        metadata: { exit_code: 0, command: "npm test" },
      },
      new Date("2026-06-06T12:02:00Z")
    );

    const events = await readAgentRunEventsForSprite("sprite-agent-workbench");
    const timeline = await getAgentRunTimeline("sprite-agent-workbench");

    expect(events.map((event) => event.type)).toEqual([
      "command_finished",
      "run_started",
    ]);
    expect(timeline.runs).toHaveLength(1);
    expect(timeline.runs[0]).toMatchObject({
      runId: "run-1",
      title: "Install dependencies",
      status: "success",
    });
    expect(timeline.runs[0].events.map((event) => event.type)).toEqual([
      "run_started",
      "command_finished",
    ]);
  });

  it("rejects secret-looking text before it is stored", async () => {
    useRunEventFile();

    await expect(
      recordAgentRunEvent({
        spriteName: "sprite-agent-workbench",
        type: "run_started",
        summary: "SPRITES_API_TOKEN=super-secret",
      })
    ).rejects.toThrow("secret");

    await expect(
      readAgentRunEventsForSprite("sprite-agent-workbench")
    ).resolves.toEqual([]);
  });

  it("stores bounded file-change metadata and redacts secret-like paths", async () => {
    useRunEventFile();

    const event = await recordAgentRunEvent(
      {
        spriteName: "sprite-agent-workbench",
        runId: "run-files",
        type: "file_changed",
        label: "UI files changed",
        files: [
          { status: "M", path: "app/page.tsx" },
          { status: "A", path: ".env.local" },
          { status: "D", path: "old/file.ts" },
        ],
        diffStat: "3 files changed, 42 insertions(+)",
      },
      new Date("2026-06-06T12:03:00Z")
    );

    expect(event).toMatchObject({
      type: "file_changed",
      status: "warning",
      fileChange: {
        fileCount: 3,
        redactedCount: 1,
        diffStat: "3 files changed, 42 insertions(+)",
        files: [
          { status: "M", path: "app/page.tsx", redacted: false },
          {
            status: "A",
            path: "[redacted secret-like path]",
            redacted: true,
          },
          { status: "D", path: "old/file.ts", redacted: false },
        ],
      },
    });
  });

  it("rejects invalid file-change metadata before storage", async () => {
    useRunEventFile();

    await expect(
      recordAgentRunEvent({
        spriteName: "sprite-agent-workbench",
        type: "file_changed",
        files: [{ status: "R", path: "app/page.tsx" }],
      })
    ).rejects.toThrow("A, M, or D");

    await expect(
      recordAgentRunEvent({
        spriteName: "sprite-agent-workbench",
        type: "run_started",
        files: [{ status: "M", path: "app/page.tsx" }],
      })
    ).rejects.toThrow("only valid for file_changed");

    await expect(
      readAgentRunEventsForSprite("sprite-agent-workbench")
    ).resolves.toEqual([]);
  });

  it("validates run IDs as safe grouping keys", () => {
    expect(() =>
      validateAgentRunEventInput({
        spriteName: "sprite-agent-workbench",
        type: "run_started",
        runId: "not a safe run id",
      })
    ).toThrow("Run id");
  });

  it("builds checkpoint context without duplicating raw comments", () => {
    const input = buildCheckpointCreatedEventInput({
      spriteName: "sprite-agent-workbench",
      checkpointId: "v9",
      comment: "before risky deploy",
      message: "Checkpoint v9 created",
    });
    const event = validateAgentRunEventInput(
      input,
      new Date("2026-06-06T12:00:00Z")
    );

    expect(event).toMatchObject({
      type: "checkpoint_created",
      label: "Checkpoint v9 created",
      summary: "Created from Sprite Agent Workbench with a checkpoint comment.",
      status: "success",
      metadata: {
        checkpoint_id: "v9",
        source: "workbench",
        has_comment: true,
      },
    });
    expect(event.summary).not.toContain("before risky deploy");
  });

  it("links the safety checkpoint id on restore events when one was created", () => {
    const withSafety = validateAgentRunEventInput(
      buildRestorePerformedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v3",
        message: "Restored to v3",
        safetyCheckpointId: "v9",
      }),
      new Date("2026-06-10T12:00:00Z")
    );

    expect(withSafety.metadata).toMatchObject({
      restored_checkpoint_id: "v3",
      safety_checkpoint_id: "v9",
      source: "workbench",
    });

    const withoutSafety = validateAgentRunEventInput(
      buildRestorePerformedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v3",
        message: "Restored to v3",
        safetyCheckpointId: null,
      }),
      new Date("2026-06-10T12:00:00Z")
    );

    expect(withoutSafety.metadata).not.toHaveProperty("safety_checkpoint_id");
  });

  it("returns context events linked to a specific checkpoint id", async () => {
    useRunEventFile();

    const linked = await recordAgentRunEvent(
      buildCheckpointCreatedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v9",
        comment: null,
        message: "Checkpoint v9 created",
      }),
      new Date("2026-06-06T12:00:00Z")
    );
    await recordAgentRunEvent(
      buildCheckpointCreatedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v8",
        comment: null,
        message: "Checkpoint v8 created",
      }),
      new Date("2026-06-06T12:01:00Z")
    );
    const events = await readAgentRunEventsForSprite("sprite-agent-workbench");

    expect(getCheckpointContextEvents(events, "v9")).toEqual([linked]);
    expect(getCheckpointContextEvents(events, "missing")).toEqual([]);
  });

  it("builds a verification event whose status reflects pass or fail", () => {
    const passing = validateAgentRunEventInput(
      buildVerificationEventInput({
        spriteName: "sprite-agent-workbench",
        passing: true,
        summary: "Smoke test green",
        checkpointId: "v9",
        runId: "run-abc",
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(passing).toMatchObject({
      type: "command_finished",
      label: "Verification: passing",
      status: "success",
      runId: "run-abc",
      metadata: { verification: "pass", checkpoint_id: "v9" },
    });

    const failing = validateAgentRunEventInput(
      buildVerificationEventInput({
        spriteName: "sprite-agent-workbench",
        passing: false,
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(failing).toMatchObject({
      type: "command_finished",
      label: "Verification: failing",
      status: "error",
      metadata: { verification: "fail" },
    });
    expect(failing.metadata).not.toHaveProperty("checkpoint_id");
  });

  it("links an arbitrary event to a checkpoint via metadata.checkpoint_id", async () => {
    useRunEventFile();

    const linked = await recordAgentRunEvent(
      buildVerificationEventInput({
        spriteName: "sprite-agent-workbench",
        passing: true,
        checkpointId: "v9",
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    const events = await readAgentRunEventsForSprite("sprite-agent-workbench");

    expect(getCheckpointContextEvents(events, "v9")).toEqual([linked]);
  });

  it("captures app health on a checkpoint_created event when provided", () => {
    const withHealth = validateAgentRunEventInput(
      buildCheckpointCreatedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v9",
        comment: null,
        message: "Checkpoint v9 created",
        appHealth: "200 OK",
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(withHealth.metadata).toMatchObject({ app_health: "200 OK" });

    const withoutHealth = validateAgentRunEventInput(
      buildCheckpointCreatedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v9",
        comment: null,
        message: "Checkpoint v9 created",
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(withoutHealth.metadata).not.toHaveProperty("app_health");
  });

  it("stamps restore duration on the restore event when provided", () => {
    const timed = validateAgentRunEventInput(
      buildRestorePerformedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v3",
        durationMs: 1234.6,
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(timed.metadata).toMatchObject({ duration_ms: 1235 });

    const untimed = validateAgentRunEventInput(
      buildRestorePerformedEventInput({
        spriteName: "sprite-agent-workbench",
        checkpointId: "v3",
      }),
      new Date("2026-06-10T12:00:00Z")
    );
    expect(untimed.metadata).not.toHaveProperty("duration_ms");
  });

  it("counts events and files recorded after a checkpoint create_time", () => {
    const events = [
      makeEventAt("2026-06-06T12:00:00Z", "run_started"),
      makeEventAt("2026-06-06T12:00:30Z", "file_changed", 3),
      makeEventAt("2026-06-06T12:01:00Z", "file_changed", 2),
    ];

    // Checkpoint created at 12:00:30 — only the 12:01:00 event is "after".
    const impact = getEventsSinceCheckpoint(events, "2026-06-06T12:00:30Z");
    expect(impact.eventCount).toBe(1);
    expect(impact.fileCount).toBe(2);

    // Earlier checkpoint sees both file_changed events.
    const earlier = getEventsSinceCheckpoint(events, "2026-06-06T11:59:00Z");
    expect(earlier.eventCount).toBe(3);
    expect(earlier.fileCount).toBe(5);

    // Unparseable create_time yields zeros rather than throwing.
    const bad = getEventsSinceCheckpoint(events, "not-a-date");
    expect(bad).toEqual({ eventCount: 0, fileCount: 0, events: [] });
  });
});

function makeEventAt(
  createdAt: string,
  type: string,
  fileCount = 0
): import("../lib/agent-runs").AgentRunEvent {
  return {
    id: `evt-${createdAt}`,
    runId: "run-1",
    spriteName: "sprite-agent-workbench",
    type: type as never,
    label: type,
    summary: null,
    status: "info",
    metadata: {},
    fileChange:
      fileCount > 0
        ? { files: [], fileCount, redactedCount: 0, diffStat: null }
        : null,
    createdAt,
  };
}

describe("agent run event route", () => {
  it("records a run event through a same-origin JSON request", async () => {
    useRunEventFile();

    const response = await createRunEventRoute(
      new Request("http://localhost/api/runs/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          spriteName: "sprite-agent-workbench",
          type: "run_completed",
          runId: "run-route",
          label: "Route smoke test",
        }),
      })
    );
    const body = (await response.json()) as {
      ok?: boolean;
      event?: { runId?: string; status?: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.event).toMatchObject({
      runId: "run-route",
      status: "success",
    });
    await expect(
      readAgentRunEventsForSprite("sprite-agent-workbench")
    ).resolves.toHaveLength(1);
  });

  it("records a file_changed event through the route", async () => {
    useRunEventFile();

    const response = await createRunEventRoute(
      new Request("http://localhost/api/runs/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          spriteName: "sprite-agent-workbench",
          type: "file_changed",
          runId: "run-route-files",
          label: "Files changed",
          files: [
            { status: "M", path: "app/page.tsx" },
            { status: "A", path: "config/token.txt" },
          ],
          diffStat: "2 files changed, 12 insertions(+)",
        }),
      })
    );
    const body = (await response.json()) as {
      ok?: boolean;
      event?: {
        fileChange?: {
          fileCount?: number;
          redactedCount?: number;
          files?: Array<{ path?: string; redacted?: boolean }>;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.event?.fileChange).toMatchObject({
      fileCount: 2,
      redactedCount: 1,
      files: [
        { path: "app/page.tsx", redacted: false },
        { path: "[redacted secret-like path]", redacted: true },
      ],
    });
  });

  it("rejects run event writes without a same-origin request", async () => {
    useRunEventFile();

    const response = await createRunEventRoute(
      new Request("http://localhost/api/runs/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spriteName: "sprite-agent-workbench",
          type: "run_started",
        }),
      })
    );
    const body = (await response.json()) as { ok?: boolean; message?: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Origin");
    await expect(
      readAgentRunEventsForSprite("sprite-agent-workbench")
    ).resolves.toEqual([]);
  });
});

function useRunEventFile() {
  const dir = mkdtempSync(join(tmpdir(), "sprite-workbench-runs-test-"));
  tempDirs.push(dir);
  vi.stubEnv(
    "SPRITE_AGENT_WORKBENCH_RUN_EVENTS_PATH",
    join(dir, "run-events.jsonl")
  );
}
