import { describe, expect, it } from "vitest";
import {
  isSecretLikePath,
  redactSecretLikePath,
  REDACTED_SECRET_PATH,
} from "../lib/path-redaction";

describe("secret-like path redaction", () => {
  it.each([
    ".env",
    ".env.local",
    "apps/web/.env.production",
    "deploy/key.pem",
    "ssh/id_rsa_backup",
    "ssh/id_ed25519",
    ".npmrc",
    ".sprite/config.json",
    "config/credentials.json",
    "config/service-secret.json",
    "tokens/sprites-token.txt",
    "Library/Keychains/login.keychain-db",
  ])("redacts %s", (path) => {
    expect(isSecretLikePath(path)).toBe(true);
    expect(redactSecretLikePath(path)).toEqual({
      path: REDACTED_SECRET_PATH,
      redacted: true,
    });
  });

  it("keeps normal source paths intact", () => {
    expect(redactSecretLikePath("app/page.tsx")).toEqual({
      path: "app/page.tsx",
      redacted: false,
    });
    expect(redactSecretLikePath("src/components/Button.tsx")).toEqual({
      path: "src/components/Button.tsx",
      redacted: false,
    });
  });
});
