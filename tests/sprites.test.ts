import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpriteApiUrl,
  formatSpriteApiError,
  getDashboardData,
  getSpriteDataSource,
  parseSpriteApiJson,
} from "../lib/sprites";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

describe("Sprite API helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses JSON from noisy Sprite CLI output", () => {
    const result = parseSpriteApiJson<{ name: string }>(
      "Using chris-sean-dabatos sprite-agent-workbench\nCalling API...\n{\"name\":\"recallmem\"}"
    );

    expect(result).toEqual({ name: "recallmem" });
  });

  it("throws a useful error when CLI output has no JSON", () => {
    expect(() => parseSpriteApiJson("Moved Permanently")).toThrow(
      "Sprite API returned no JSON"
    );
  });

  it("detects token mode when SPRITES_API_TOKEN is configured", () => {
    vi.stubEnv("SPRITES_API_TOKEN", "token-123");

    expect(getSpriteDataSource()).toBe("token");
  });

  it("falls back to CLI mode when SPRITES_API_TOKEN is empty", () => {
    vi.stubEnv("SPRITES_API_TOKEN", "   ");

    expect(getSpriteDataSource()).toBe("cli");
  });

  it("keeps API URL construction predictable", () => {
    expect(
      createSpriteApiUrl("/v1/sprites/", "https://api.sprites.dev").toString()
    ).toBe("https://api.sprites.dev/v1/sprites/");
  });

  it("formats JSON API errors for user-facing setup messages", () => {
    expect(
      formatSpriteApiError(
        401,
        "Unauthorized",
        JSON.stringify({ detail: "authentication failed" })
      )
    ).toBe("Sprites API request failed (401 Unauthorized): authentication failed");
  });
});

describe("getDashboardData", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses hosted token mode and fetches checkpoints without touching auth-gated app URLs", async () => {
    vi.stubEnv("SPRITES_API_TOKEN", "token-123");
    vi.stubEnv("SPRITES_API_BASE_URL", "https://api.test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);

      if (url === "https://api.test/v1/sprites/") {
        return jsonResponse({
          name: "chris-sean-dabatos",
          running: 1,
          warm: 0,
          cold: 1,
          running_limit: 10,
          warm_limit: 10,
          next_continuation_token: null,
          has_more: false,
          sprites: [
            {
              id: "sprite-1",
              name: "recallmem",
              status: "cold",
              version: null,
              url: "https://recallmem.example.test",
              url_settings: { auth: "sprite", private_access: "admins" },
              created_at: "2026-06-01T00:00:00Z",
              organization: "chris-sean-dabatos",
              last_running_at: null,
              last_warming_at: null,
              updated_at: "2026-06-01T00:00:00Z",
              environment_version: null,
            },
          ],
        });
      }

      if (url === "https://api.test/v1/sprites/recallmem/checkpoints") {
        return jsonResponse([
          {
            id: "Current",
            create_time: "2026-06-05T19:18:02Z",
            is_auto: false,
          },
        ]);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await getDashboardData();

    expect(data.ok).toBe(true);
    expect(data.source).toBe("token");
    expect(data.orgName).toBe("chris-sean-dabatos");
    expect(data.counts).toMatchObject({ total: 1, running: 1, cold: 1 });
    expect(data.sprites[0].name).toBe("recallmem");
    expect(data.sprites[0].health.label).toBe("Auth gated");
    expect(data.sprites[0].checkpoints).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: {
        accept: "application/json",
        authorization: "Bearer token-123",
      },
    });
  });

  it("returns a hosted-token setup error when the token is invalid", async () => {
    vi.stubEnv("SPRITES_API_TOKEN", "bad-token");
    vi.stubEnv("SPRITES_API_BASE_URL", "https://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { detail: "authentication failed" },
          { ok: false, status: 401, statusText: "Unauthorized" }
        )
      )
    );

    const data = await getDashboardData();

    expect(data.ok).toBe(false);
    expect(data.source).toBe("token");
    expect(data.error?.message).toContain("authentication failed");
    expect(data.error?.hint).toContain("SPRITES_API_TOKEN");
  });
});
