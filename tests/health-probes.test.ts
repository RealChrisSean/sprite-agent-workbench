import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probePublicSpriteHealth,
  readLatestHealthProbes,
  recordHealthProbe,
  statusMatchesExpectation,
  validateExpectedStatuses,
  validateHealthProbePath,
} from "../lib/health-probes";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("explicit health probes", () => {
  it("accepts configured 404 responses and sends GET without following redirects", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 404, statusText: "Not Found" })
    );
    const result = await probePublicSpriteHealth({
      spriteName: "hermesagent",
      spriteUrl: "https://hermes.example.test",
      urlAuth: "public",
      path: "/",
      expectedStatuses: "200-399,404",
      now: new Date("2026-07-13T12:00:00Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      status: "ok",
      label: "404 Not Found",
      httpStatus: 404,
      expectedStatuses: "200-399,404",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://hermes.example.test/"),
      expect.objectContaining({ method: "GET", redirect: "manual" })
    );
  });

  it("validates relative paths and status ranges", () => {
    expect(validateHealthProbePath("/health?deep=1")).toBe("/health?deep=1");
    expect(() => validateHealthProbePath("https://other.test/")).toThrow(
      "relative path"
    );
    expect(validateExpectedStatuses(" 200-399, 404 ")).toBe("200-399,404");
    expect(statusMatchesExpectation(404, "200-399,404")).toBe(true);
    expect(statusMatchesExpectation(500, "200-399,404")).toBe(false);
  });

  it("stores only the latest explicit result per Sprite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workbench-health-test-"));
    tempDirs.push(dir);
    vi.stubEnv(
      "SPRITE_AGENT_WORKBENCH_HEALTH_PROBES_PATH",
      join(dir, "health.jsonl")
    );
    const first = await probePublicSpriteHealth({
      spriteName: "hermesagent",
      spriteUrl: "https://hermes.example.test",
      urlAuth: "public",
      expectedStatuses: "404",
      now: new Date("2026-07-13T12:00:00Z"),
      fetchImpl: (async () =>
        new Response(null, { status: 404 })) as unknown as typeof fetch,
    });
    const second = { ...first, label: "200 OK", httpStatus: 200, observedAt: "2026-07-13T12:05:00.000Z" };
    await recordHealthProbe(first);
    await recordHealthProbe(second);

    expect((await readLatestHealthProbes()).get("hermesagent")).toEqual(second);
  });
});
