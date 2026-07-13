import { describe, expect, it } from "vitest";
import {
  makeCgroupSampler,
  makeSyntheticSampler,
  parseCgroupInteger,
  parseCpuStatUsageUsec,
  postSample,
} from "../scripts/meter-core.mjs";

describe("parseCpuStatUsageUsec", () => {
  it("extracts usage_usec from cgroup v2 cpu.stat", () => {
    const text = [
      "usage_usec 123456789",
      "user_usec 100000000",
      "system_usec 23456789",
    ].join("\n");
    expect(parseCpuStatUsageUsec(text)).toBe(123456789);
  });

  it("throws when usage_usec is missing", () => {
    expect(() => parseCpuStatUsageUsec("user_usec 1\n")).toThrow(/usage_usec/);
  });
});

describe("parseCgroupInteger", () => {
  it("parses a plain integer", () => {
    expect(parseCgroupInteger("2147483648\n")).toBe(2147483648);
  });
  it("treats 'max' as 0", () => {
    expect(parseCgroupInteger("max\n")).toBe(0);
  });
  it("rejects negatives", () => {
    expect(() => parseCgroupInteger("-5")).toThrow();
  });
});

describe("makeCgroupSampler", () => {
  it("reads injected cgroup files and storage into a sample", async () => {
    const fakeRead = async (path: string) => {
      if (path.endsWith("cpu.stat")) return "usage_usec 5000000\n";
      if (path.endsWith("memory.current")) return "1073741824\n";
      throw new Error(`unexpected read: ${path}`);
    };
    const sampler = makeCgroupSampler({
      spriteName: "demo",
      read: fakeRead as unknown as typeof import("node:fs/promises").readFile,
      hotStorageBytes: async () => 2048,
      coldStorageBytes: async () => 4096,
    });
    const out = await sampler(new Date("2026-06-20T00:00:00Z"));
    expect(out).toMatchObject({
      spriteName: "demo",
      observedAt: "2026-06-20T00:00:00.000Z",
      cpuUsageUsec: 5000000,
      memCurrentBytes: 1073741824,
      storageHotBytes: 2048,
      storageColdBytes: 4096,
      source: "cgroup",
    });
  });
});

describe("makeSyntheticSampler", () => {
  it("advances the cumulative CPU counter monotonically", async () => {
    const sampler = makeSyntheticSampler({ spriteName: "demo", random: () => 0.5 });
    const a = await sampler(new Date("2026-06-20T00:00:00Z"));
    const b = await sampler(new Date("2026-06-20T00:01:00Z"));
    expect(a.cpuUsageUsec).toBe(0); // first tick has no prior interval
    expect(b.cpuUsageUsec).toBeGreaterThan(a.cpuUsageUsec);
    expect(b.source).toBe("synthetic");
  });
});

describe("postSample", () => {
  it("posts to /api/meter/samples with the ingest token and no redirects", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      captured = { url: url.toString(), init };
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await postSample({
      workbenchUrl: "http://localhost:3001",
      sample: { spriteName: "demo" },
      ingestToken: "ingest-test-token",
      fetchImpl,
    });

    expect(captured!.url).toBe("http://localhost:3001/api/meter/samples");
    expect(
      (captured!.init.headers as Record<string, string>)[
        "x-workbench-ingest-token"
      ]
    ).toBe("ingest-test-token");
    expect(captured!.init.redirect).toBe("manual");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(
      postSample({
        workbenchUrl: "http://localhost:3001",
        sample: {},
        ingestToken: "ingest-test-token",
        fetchImpl,
      })
    ).rejects.toThrow("bad");
  });

  it("rejects HTML that could be a followed auth page", async () => {
    const fetchImpl = (async () =>
      new Response("<html>sign in</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    await expect(
      postSample({
        workbenchUrl: "http://localhost:3001",
        sample: {},
        ingestToken: "ingest-test-token",
        fetchImpl,
      })
    ).rejects.toThrow("refusing to treat it as ingest success");
  });
});
