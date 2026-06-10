export const REDACTED_SECRET_PATH = "[redacted secret-like path]";

const SECRET_SEGMENT_PATTERNS = [
  /^\.env(?:\.|$|[-_])/i,
  /^\.env$/i,
  /^\.npmrc$/i,
  /^\.sprite$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
];

const SECRET_PATH_PATTERNS = [
  /credential/i,
  /secret/i,
  /token/i,
  /keychain/i,
  /keychains/i,
];

export interface RedactedPath {
  path: string;
  redacted: boolean;
}

export function redactSecretLikePath(path: string): RedactedPath {
  const normalized = path.replaceAll("\\", "/").trim();

  if (isSecretLikePath(normalized)) {
    return {
      path: REDACTED_SECRET_PATH,
      redacted: true,
    };
  }

  return {
    path: normalized,
    redacted: false,
  };
}

export function isSecretLikePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").trim();
  const segments = normalized.split("/").filter(Boolean);

  return (
    SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    segments.some((segment) =>
      SECRET_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment))
    )
  );
}
