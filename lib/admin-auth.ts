import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "sprite_workbench_admin";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const SESSION_VERSION = "v1";

export interface AdminAccessState {
  configured: boolean;
  unlocked: boolean;
}

export function getAdminToken(): string | null {
  return process.env.WORKBENCH_ADMIN_TOKEN?.trim() || null;
}

export function getIngestToken(): string | null {
  return process.env.WORKBENCH_INGEST_TOKEN?.trim() || null;
}

export function validateAdminCredential(value: unknown): void {
  const configured = getAdminToken();
  if (!configured) {
    throw new Error("Workbench write access is not configured.");
  }
  if (typeof value !== "string" || !constantTimeEqual(value, configured)) {
    throw new Error("Admin token is incorrect.");
  }
}

export function createAdminSessionValue(now = new Date()): string {
  const token = getAdminToken();
  if (!token) throw new Error("Workbench write access is not configured.");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = `${SESSION_VERSION}.${issuedAt}`;
  return `${payload}.${signSession(payload, token)}`;
}

export function verifyAdminSessionValue(
  value: string | null | undefined,
  now = new Date()
): boolean {
  const token = getAdminToken();
  if (!token || !value) return false;
  const match = value.match(/^v1\.(\d+)\.([a-f0-9]{64})$/);
  if (!match) return false;

  const issuedAt = Number(match[1]);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > nowSeconds + 60 ||
    nowSeconds - issuedAt > ADMIN_SESSION_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const payload = `${SESSION_VERSION}.${issuedAt}`;
  return constantTimeEqual(match[2], signSession(payload, token));
}

export function getAdminAccessFromCookieHeader(
  cookieHeader: string | null,
  now = new Date()
): AdminAccessState {
  const cookieValue = readCookie(cookieHeader, ADMIN_SESSION_COOKIE);
  return {
    configured: Boolean(getAdminToken()),
    unlocked: verifyAdminSessionValue(cookieValue, now),
  };
}

export function serializeAdminSessionCookie({
  value,
  secure,
  maxAge = ADMIN_SESSION_MAX_AGE_SECONDS,
}: {
  value: string;
  secure: boolean;
  maxAge?: number;
}): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded
    ? forwarded.split(",")[0].trim() === "https"
    : new URL(request.url).protocol === "https:";
}

function signSession(payload: string, token: string): string {
  return createHmac("sha256", token).update(payload).digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", "workbench-compare")
    .update(left)
    .digest();
  const rightDigest = createHmac("sha256", "workbench-compare")
    .update(right)
    .digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const [key, ...valueParts] = item.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
