import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type SpriteAuthSource = "connector" | "token" | "saved-token" | "cli";

export interface SpriteAuthConfig {
  source: SpriteAuthSource;
  token?: string;
  gatewayBaseUrl?: string;
}

export interface SpriteAuthStatus {
  source: SpriteAuthSource;
  connectorConfigured: boolean;
  envTokenConfigured: boolean;
  savedTokenConfigured: boolean;
  savedTokenPath: string;
}

interface SavedTokenFile {
  spritesApiToken?: unknown;
  updatedAt?: unknown;
}

export function getSpriteAuthConfig(): SpriteAuthConfig {
  const gatewayBaseUrl = process.env.SPRITES_API_GATEWAY_BASE_URL?.trim();
  if (gatewayBaseUrl) {
    return { source: "connector", gatewayBaseUrl };
  }

  const envToken = process.env.SPRITES_API_TOKEN?.trim();
  if (envToken) {
    return { source: "token", token: envToken };
  }

  const savedToken = readSavedSpriteApiToken();
  if (savedToken) {
    return { source: "saved-token", token: savedToken };
  }

  return { source: "cli" };
}

export function getSpriteAuthStatus(): SpriteAuthStatus {
  const config = getSpriteAuthConfig();

  return {
    source: config.source,
    connectorConfigured: Boolean(
      process.env.SPRITES_API_GATEWAY_BASE_URL?.trim()
    ),
    envTokenConfigured: Boolean(process.env.SPRITES_API_TOKEN?.trim()),
    savedTokenConfigured: Boolean(readSavedSpriteApiToken()),
    savedTokenPath: getSavedSpriteSecretPath(),
  };
}

export function getSavedSpriteSecretPath(): string {
  const home = process.env.HOME?.trim() || "/tmp";

  return (
    process.env.SPRITE_AGENT_WORKBENCH_SECRET_PATH?.trim() ||
    join(
      /*turbopackIgnore: true*/ home,
      ".sprite-agent-workbench",
      "secrets.json"
    )
  );
}

export function readSavedSpriteApiToken(): string | null {
  try {
    const raw = readFileSync(
      /*turbopackIgnore: true*/ getSavedSpriteSecretPath(),
      "utf8"
    );
    const parsed = JSON.parse(raw) as SavedTokenFile;
    return typeof parsed.spritesApiToken === "string" &&
      parsed.spritesApiToken.trim()
      ? parsed.spritesApiToken.trim()
      : null;
  } catch {
    return null;
  }
}

export function saveSavedSpriteApiToken(token: string): void {
  const path = getSavedSpriteSecretPath();
  const dir = dirname(path);

  mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
  chmodSync(/*turbopackIgnore: true*/ dir, 0o700);
  writeFileSync(
    /*turbopackIgnore: true*/ path,
    `${JSON.stringify(
      {
        spritesApiToken: token,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  chmodSync(/*turbopackIgnore: true*/ path, 0o600);
}

export function deleteSavedSpriteApiToken(): boolean {
  try {
    rmSync(/*turbopackIgnore: true*/ getSavedSpriteSecretPath(), {
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function validateTokenInput(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Token must be a string.");
  }

  const token = value.trim();
  if (!token) {
    throw new Error("Token is required.");
  }

  if (token.length > 4096) {
    throw new Error("Token is too long.");
  }

  if (/[\r\n]/.test(token)) {
    throw new Error("Token must be a single line.");
  }

  return token;
}

export function getAuthSourceLabel(source: SpriteAuthSource | null): string {
  if (source === "connector") return "Sprites Connector";
  if (source === "token") return "server env token";
  if (source === "saved-token") return "saved server token";
  if (source === "cli") return "local CLI";
  return "not configured";
}
