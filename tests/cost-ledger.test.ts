import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCostExposureSummary,
  observeCostExposure,
  readCostExposure,
  readSpriteObservations,
  type SpriteObservation,
} from "../lib/cost-ledger";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("passive cost exposure ledger", () => {
  it("records passive Sprite observations without waking anything", async () => {
    useObservationFile();

    const summary = await observeCostExposure({
      source: "token",
      observedAt: new Date("2026-06-06T12:00:00Z"),
      sprites: [
        makeObservableSprite("sprite-agent-workbench", "warm", "public"),
        makeObservableSprite("recallmem", "cold", "sprite"),
      ],
    });
    const observations = await readSpriteObservations();
    const recallmem = observations.find(
      (observation) => observation.spriteName === "recallmem"
    );

    expect(observations).toHaveLength(2);
    expect(recallmem).toMatchObject({
      spriteName: "recallmem",
      status: "cold",
      urlAuth: "sprite",
      source: "token",
    });
    expect(summary).toMatchObject({
      activeNow: 1,
      warmNow: 1,
      runningNow: 0,
      publicUrlCount: 1,
      writeError: null,
    });
    expect(summary.riskFlags.map((flag) => flag.label)).toContain(
      "1 public URL"
    );
  });

  it("reads current state without creating an observation ledger", async () => {
    const path = useObservationFile();
    const summary = await readCostExposure({
      source: "token",
      observedAt: new Date("2026-06-06T12:00:00Z"),
      sprites: [makeObservableSprite("workbench", "running", "public")],
    });

    expect(summary.activeNow).toBe(1);
    expect(summary.observationCount).toBe(0);
    expect(summary.activeTimeStatus).toBe("insufficient");
    expect(existsSync(path)).toBe(false);
  });

  it("computes observed active time conservatively from refresh history", () => {
    const observations: SpriteObservation[] = [
      makeObservation("workbench", "warm", "2026-06-06T12:00:00Z"),
      makeObservation("workbench", "warm", "2026-06-06T12:10:00Z"),
      makeObservation("workbench", "cold", "2026-06-06T12:20:00Z"),
      makeObservation("workbench", "warm", "2026-06-06T16:00:00Z"),
      makeObservation("workbench", "cold", "2026-06-06T18:00:00Z"),
    ];

    const summary = buildCostExposureSummary({
      observations,
      currentObservations: [
        makeObservation("workbench", "cold", "2026-06-06T18:00:00Z"),
      ],
      now: new Date("2026-06-06T18:00:00Z"),
    });

    expect(summary.totalObservedActiveMs).toBe(50 * 60 * 1000);
    expect(summary.sprites[0]).toMatchObject({
      spriteName: "workbench",
      observationCount: 5,
      observedActiveMs: 50 * 60 * 1000,
      lastObservedActiveAt: "2026-06-06T16:00:00Z",
    });
    expect(summary.riskFlags.map((flag) => flag.label)).not.toContain(
      "More than 1h observed active"
    );
  });
});

function useObservationFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "sprite-workbench-cost-test-"));
  tempDirs.push(dir);
  const path = join(dir, "observations.jsonl");
  vi.stubEnv(
    "SPRITE_AGENT_WORKBENCH_OBSERVATIONS_PATH",
    path
  );
  return path;
}

function makeObservableSprite(
  name: string,
  status: string,
  auth: string
) {
  return {
    name,
    status,
    organization: "chris-sean-dabatos",
    url: `https://${name}.example.test`,
    url_settings: { auth },
    last_running_at: null,
    last_warming_at: null,
    checkpoints: [],
    checkpointCountLoaded: false,
  };
}

function makeObservation(
  spriteName: string,
  status: string,
  observedAt: string
): SpriteObservation {
  return {
    observedAt,
    spriteName,
    organization: "chris-sean-dabatos",
    status,
    urlAuth: "sprite",
    hasUrl: true,
    lastRunningAt: null,
    lastWarmingAt: null,
    checkpointCount: null,
    checkpointCountLoaded: false,
    source: "token",
  };
}
