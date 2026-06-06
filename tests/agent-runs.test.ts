import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createRunEventRoute } from "../app/api/runs/events/route";
import {
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

  it("validates run IDs as safe grouping keys", () => {
    expect(() =>
      validateAgentRunEventInput({
        spriteName: "sprite-agent-workbench",
        type: "run_started",
        runId: "not a safe run id",
      })
    ).toThrow("Run id");
  });
});

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
