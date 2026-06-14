import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCheckpointEventPayloads,
  buildVerifyPayload,
  dispatchRecord,
  extractFlag,
  parseCheckpointId,
  resolveSpriteName,
} from "../scripts/workbench-core.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extractFlag", () => {
  it("removes a flag and its value, returning the value and the rest", () => {
    expect(extractFlag(["a", "--ref", "main", "b"], "--ref")).toEqual({
      value: "main",
      rest: ["a", "b"],
    });
  });

  it("returns undefined and the original args when the flag is absent", () => {
    expect(extractFlag(["a", "b"], "--ref")).toEqual({
      value: undefined,
      rest: ["a", "b"],
    });
  });
});

describe("parseCheckpointId", () => {
  it("pulls the vN id out of CLI output", () => {
    expect(parseCheckpointId("Checkpoint v12 created")).toBe("v12");
  });
  it("returns null when there is no vN token", () => {
    expect(parseCheckpointId("nothing here")).toBeNull();
  });
});

describe("resolveSpriteName", () => {
  it("prefers the explicit value", () => {
    expect(
      resolveSpriteName({ explicit: "from-flag", env: { SPRITE_NAME: "from-env" } })
    ).toBe("from-flag");
  });

  it("falls back to SPRITE_NAME", () => {
    expect(resolveSpriteName({ env: { SPRITE_NAME: "from-env" } })).toBe(
      "from-env"
    );
  });

  it("reads the .sprite context file when no flag or env is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprite-ctx-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, ".sprite"),
      JSON.stringify({ organization: "org", sprite: "from-context" })
    );
    expect(resolveSpriteName({ cwd: dir, env: {} })).toBe("from-context");
  });

  it("returns null when nothing resolves", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprite-ctx-empty-"));
    tempDirs.push(dir);
    expect(resolveSpriteName({ cwd: dir, env: {} })).toBeNull();
  });
});

describe("dispatchRecord", () => {
  it("builds a start event", () => {
    expect(dispatchRecord("start", ["Fix bug", "details"])).toEqual({
      payload: {
        type: "run_started",
        label: "Fix bug",
        summary: "details",
        status: "info",
      },
    });
  });

  it("maps verify pass/fail to success/error status", () => {
    expect(dispatchRecord("verify", ["pass"]).payload).toMatchObject({
      type: "command_finished",
      label: "Verification: passing",
      status: "success",
      metadata: { verification: "pass" },
    });
    expect(dispatchRecord("verify", ["fail"]).payload).toMatchObject({
      label: "Verification: failing",
      status: "error",
      metadata: { verification: "fail" },
    });
  });

  it("merges --checkpoint into metadata for any command", () => {
    const { payload } = dispatchRecord("complete", [
      "Done",
      "--checkpoint",
      "v9",
    ]);
    expect(payload.metadata).toMatchObject({ checkpoint_id: "v9" });
  });

  it("throws a clear error on a bad verify verdict", () => {
    expect(() => dispatchRecord("verify", ["maybe"])).toThrow("pass");
  });
});

describe("buildCheckpointEventPayloads", () => {
  it("always emits a checkpoint_created carrying the id and intent", () => {
    const payloads = buildCheckpointEventPayloads({
      checkpointId: "v12",
      intent: "before auth refactor",
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      type: "checkpoint_created",
      label: "Checkpoint v12 created",
      summary: "before auth refactor",
      metadata: {
        checkpoint_id: "v12",
        source: "workbench-cli",
        has_comment: true,
      },
    });
  });

  it("adds file_changed and verify events, all linked to the checkpoint", () => {
    const payloads = buildCheckpointEventPayloads({
      checkpointId: "v12",
      intent: null,
      fileChange: {
        files: [{ path: "app/page.tsx", status: "M" }],
        diffStat: "1 file changed",
      },
      verify: "pass",
    });
    const types = payloads.map((p) => p.type);
    expect(types).toEqual([
      "checkpoint_created",
      "file_changed",
      "command_finished",
    ]);
    for (const payload of payloads) {
      expect(payload.metadata.checkpoint_id).toBe("v12");
    }
  });

  it("omits file_changed when there are no files", () => {
    const payloads = buildCheckpointEventPayloads({
      checkpointId: "v12",
      intent: null,
      fileChange: { files: [], diffStat: undefined },
    });
    expect(payloads.map((p) => p.type)).toEqual(["checkpoint_created"]);
  });
});

describe("buildVerifyPayload", () => {
  it("defaults summary to null", () => {
    expect(buildVerifyPayload(true).summary).toBeNull();
  });
});
