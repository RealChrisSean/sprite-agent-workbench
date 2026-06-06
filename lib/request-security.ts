export function assertSameOriginRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new Error("Missing Origin header.");
  }

  const requestUrl = new URL(request.url);
  const originUrl = new URL(origin);

  if (originUrl.host !== requestUrl.host || originUrl.protocol !== requestUrl.protocol) {
    throw new Error("Origin does not match this dashboard.");
  }
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Expected application/json.");
  }
}
