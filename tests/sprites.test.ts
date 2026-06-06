import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELETE as deleteFallbackToken,
  POST as saveFallbackToken,
} from "../app/api/setup/token/route";
import {
  createSpriteApiUrl,
  createSpriteGatewayUrl,
  formatSpriteApiError,
  getDashboardData,
  getSpriteDataSource,
  getSpriteStatusGroups,
  parseSpriteApiJson,
  selectDashboardSprite,
  type DashboardSprite,
} from "../lib/sprites";
import {
  deleteSavedSpriteApiToken,
  getSpriteAuthStatus,
  readSavedSpriteApiToken,
  saveSavedSpriteApiToken,
  validateTokenInput,
} from "../lib/sprite-auth";

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

  it("detects connector mode before token mode", () => {
    vi.stubEnv(
      "SPRITES_API_GATEWAY_BASE_URL",
      "https://api.sprites.dev/v1/gateway/custom_api/conn_123"
    );
    vi.stubEnv("SPRITES_API_TOKEN", "token-123");

    expect(getSpriteDataSource()).toBe("connector");
  });

  it("falls back to CLI mode when SPRITES_API_TOKEN is empty", () => {
    vi.stubEnv("SPRITES_API_TOKEN", "   ");
    vi.stubEnv(
      "SPRITE_AGENT_WORKBENCH_SECRET_PATH",
      "/tmp/sprite-agent-workbench-test-missing.json"
    );

    expect(getSpriteDataSource()).toBe("cli");
  });

  it("keeps API URL construction predictable", () => {
    expect(
      createSpriteApiUrl("/v1/sprites/", "https://api.sprites.dev").toString()
    ).toBe("https://api.sprites.dev/v1/sprites/");
  });

  it("keeps gateway URL construction inside the connector path", () => {
    expect(
      createSpriteGatewayUrl(
        "/v1/sprites/",
        "https://api.sprites.dev/v1/gateway/custom_api/conn_123"
      ).toString()
    ).toBe(
      "https://api.sprites.dev/v1/gateway/custom_api/conn_123/v1/sprites/"
    );
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

  it("selects the requested Sprite for focused checkpoint inspection", () => {
    const sprites = [
      makeDashboardSprite("recallmem", "cold"),
      makeDashboardSprite("sprite-agent-workbench", "running"),
    ];

    expect(
      selectDashboardSprite(sprites, "sprite-agent-workbench")?.name
    ).toBe("sprite-agent-workbench");
  });

  it("falls back to the first Sprite when a requested checkpoint target is missing", () => {
    const sprites = [
      makeDashboardSprite("recallmem", "cold"),
      makeDashboardSprite("sprite-agent-workbench", "running"),
    ];

    expect(selectDashboardSprite(sprites, "missing")?.name).toBe("recallmem");
    expect(selectDashboardSprite([], "missing")).toBeNull();
  });

  it("groups Sprite status lanes for scalable warm and cold visibility", () => {
    const groups = getSpriteStatusGroups([
      makeDashboardSprite("recallmem", "cold"),
      makeDashboardSprite("voice-demo", "warm"),
      makeDashboardSprite("workbench", "running"),
      makeDashboardSprite("odd-one", "suspended"),
    ]);

    expect(groups.map((group) => [group.key, group.sprites.length])).toEqual([
      ["running", 1],
      ["warm", 1],
      ["cold", 1],
      ["other", 1],
    ]);
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

  it("uses connector mode without sending an Authorization header", async () => {
    vi.stubEnv(
      "SPRITES_API_GATEWAY_BASE_URL",
      "https://api.test/v1/gateway/custom_api/conn_123"
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);

      if (url === "https://api.test/v1/gateway/custom_api/conn_123/v1/sprites/") {
        return jsonResponse({
          name: "chris-sean-dabatos",
          running: 0,
          warm: 1,
          cold: 0,
          running_limit: 10,
          warm_limit: 10,
          next_continuation_token: null,
          has_more: false,
          sprites: [makeSpriteSummary("workbench", "warm")],
        });
      }

      if (
        url ===
        "https://api.test/v1/gateway/custom_api/conn_123/v1/sprites/workbench/checkpoints"
      ) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await getDashboardData();

    expect(data.ok).toBe(true);
    expect(data.source).toBe("connector");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty(
      "authorization"
    );
  });

  it("fetches checkpoint history only for the selected Sprite", async () => {
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
            makeSpriteSummary("recallmem", "cold"),
            makeSpriteSummary("sprite-agent-workbench", "running"),
          ],
        });
      }

      if (
        url ===
        "https://api.test/v1/sprites/sprite-agent-workbench/checkpoints"
      ) {
        return jsonResponse([
          {
            id: "v2",
            create_time: "2026-06-05T19:18:02Z",
            comment: "hosted token mode and devlog deployed",
          },
        ]);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await getDashboardData("sprite-agent-workbench");

    expect(data.ok).toBe(true);
    expect(data.sprites.find((sprite) => sprite.name === "recallmem")?.checkpoints).toHaveLength(0);
    expect(
      data.sprites.find((sprite) => sprite.name === "sprite-agent-workbench")
        ?.checkpoints
    ).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.test/v1/sprites/",
      "https://api.test/v1/sprites/sprite-agent-workbench/checkpoints",
    ]);
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

describe("saved fallback token helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("saves and deletes a server-side fallback token with status only", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprite-workbench-test-"));
    vi.stubEnv(
      "SPRITE_AGENT_WORKBENCH_SECRET_PATH",
      join(dir, "secrets.json")
    );

    saveSavedSpriteApiToken("token-abc");

    expect(readSavedSpriteApiToken()).toBe("token-abc");
    expect(getSpriteDataSource()).toBe("saved-token");
    expect(getSpriteAuthStatus()).toMatchObject({
      source: "saved-token",
      savedTokenConfigured: true,
    });

    expect(deleteSavedSpriteApiToken()).toBe(true);
    expect(readSavedSpriteApiToken()).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unsafe fallback token input", () => {
    expect(() => validateTokenInput("")).toThrow("Token is required");
    expect(() => validateTokenInput("abc\ndef")).toThrow(
      "Token must be a single line"
    );
    expect(() => validateTokenInput(123)).toThrow("Token must be a string");
  });
});

describe("setup token route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates and stores a fallback token server-side", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sprite-workbench-route-test-"));
    vi.stubEnv(
      "SPRITE_AGENT_WORKBENCH_SECRET_PATH",
      join(dir, "secrets.json")
    );
    vi.stubEnv("SPRITES_API_BASE_URL", "https://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          name: "chris-sean-dabatos",
          running: 0,
          warm: 0,
          cold: 0,
          running_limit: 10,
          warm_limit: 10,
          next_continuation_token: null,
          has_more: false,
          sprites: [],
        })
      )
    );

    const saveResponse = await saveFallbackToken(
      new Request("http://localhost/api/setup/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ token: "token-route-test" }),
      })
    );

    expect(saveResponse.status).toBe(200);
    expect(readSavedSpriteApiToken()).toBe("token-route-test");

    const deleteResponse = await deleteFallbackToken(
      new Request("http://localhost/api/setup/token", {
        method: "DELETE",
        headers: {
          origin: "http://localhost",
        },
      })
    );

    expect(deleteResponse.status).toBe(200);
    expect(readSavedSpriteApiToken()).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects fallback token writes without a same-origin request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sprite-workbench-route-test-"));
    vi.stubEnv(
      "SPRITE_AGENT_WORKBENCH_SECRET_PATH",
      join(dir, "secrets.json")
    );

    const response = await saveFallbackToken(
      new Request("http://localhost/api/setup/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: "token-route-test" }),
      })
    );

    expect(response.status).toBe(400);
    expect(readSavedSpriteApiToken()).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});

function makeDashboardSprite(
  name: string,
  status: string
): DashboardSprite {
  return {
    ...makeSpriteSummary(name, status),
    checkpoints: [],
    health: {
      status: "skipped",
      label: "No URL",
      detail: "This Sprite does not expose an app URL.",
    },
    sleep: {
      label: status,
      tone: "neutral",
      evidence: [`status: ${status}`],
    },
  };
}

function makeSpriteSummary(name: string, status: string) {
  return {
    id: `${name}-id`,
    name,
    status,
    version: null,
    url: null,
    url_settings: { auth: "sprite" },
    created_at: "2026-06-01T00:00:00Z",
    organization: "chris-sean-dabatos",
    last_running_at: null,
    last_warming_at: null,
    updated_at: "2026-06-01T00:00:00Z",
    environment_version: null,
  };
}
