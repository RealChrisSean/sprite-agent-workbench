import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAdminSessionValue,
  getAdminAccessFromCookieHeader,
  verifyAdminSessionValue,
} from "../lib/admin-auth";
import { assertIngestRequest, RequestSecurityError } from "../lib/request-security";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Workbench write credentials", () => {
  it("accepts a signed admin session for eight hours and then expires it", () => {
    vi.stubEnv("WORKBENCH_ADMIN_TOKEN", "admin-test-token");
    const issued = new Date("2026-07-13T12:00:00Z");
    const value = createAdminSessionValue(issued);

    expect(verifyAdminSessionValue(value, new Date("2026-07-13T19:59:59Z"))).toBe(true);
    expect(verifyAdminSessionValue(value, new Date("2026-07-13T20:00:01Z"))).toBe(false);
    expect(
      getAdminAccessFromCookieHeader(`sprite_workbench_admin=${value}`, issued)
    ).toEqual({ configured: true, unlocked: true });
  });

  it("requires the dedicated ingest header for machine writes", () => {
    vi.stubEnv("WORKBENCH_INGEST_TOKEN", "ingest-test-token");
    const good = new Request("https://workbench.test/api/observe", {
      headers: { "x-workbench-ingest-token": "ingest-test-token" },
    });
    expect(() => assertIngestRequest(good)).not.toThrow();

    const bad = new Request("https://workbench.test/api/observe", {
      headers: { "x-workbench-ingest-token": "wrong" },
    });
    expect(() => assertIngestRequest(bad)).toThrow(RequestSecurityError);
  });
});
