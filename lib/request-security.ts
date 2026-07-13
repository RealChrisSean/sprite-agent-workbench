import {
  getAdminAccessFromCookieHeader,
  getIngestToken,
} from "./admin-auth";
import { createHmac, timingSafeEqual } from "node:crypto";

export class RequestSecurityError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

export function assertSameOriginRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new RequestSecurityError("Missing Origin header.", 403);
  }

  const requestUrl = new URL(request.url);
  const originUrl = new URL(origin);

  if (originUrl.host !== requestUrl.host || originUrl.protocol !== requestUrl.protocol) {
    throw new RequestSecurityError("Origin does not match this dashboard.", 403);
  }
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestSecurityError("Expected application/json.", 415);
  }
}

export function assertAdminRequest(request: Request): void {
  assertSameOriginRequest(request);
  const access = getAdminAccessFromCookieHeader(request.headers.get("cookie"));
  if (!access.configured) {
    throw new RequestSecurityError(
      "Workbench write access is not configured.",
      503
    );
  }
  if (!access.unlocked) {
    throw new RequestSecurityError("Unlock admin access before writing.", 401);
  }
}

export function assertIngestRequest(request: Request): void {
  const expected = getIngestToken();
  if (!expected) {
    throw new RequestSecurityError(
      "Workbench ingest access is not configured.",
      503
    );
  }
  const supplied = request.headers.get("x-workbench-ingest-token") || "";
  if (!constantTimeEqual(supplied, expected)) {
    throw new RequestSecurityError("Ingest token is incorrect.", 401);
  }
}

export function assertAdminOrIngestRequest(request: Request): void {
  if (request.headers.has("x-workbench-ingest-token")) {
    assertIngestRequest(request);
    return;
  }
  assertAdminRequest(request);
}

export function getRequestErrorStatus(err: unknown, fallback = 400): number {
  return err instanceof RequestSecurityError ? err.status : fallback;
}

function constantTimeEqual(left: string, right: string): boolean {
  const key = "workbench-request-compare";
  const leftDigest = createHmac("sha256", key).update(left).digest();
  const rightDigest = createHmac("sha256", key).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
