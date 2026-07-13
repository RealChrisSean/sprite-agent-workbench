import {
  createAdminSessionValue,
  getAdminAccessFromCookieHeader,
  isSecureRequest,
  serializeAdminSessionCookie,
  validateAdminCredential,
} from "@/lib/admin-auth";
import {
  assertJsonRequest,
  assertSameOriginRequest,
  getRequestErrorStatus,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json(
    getAdminAccessFromCookieHeader(request.headers.get("cookie"))
  );
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);
    const body = (await request.json()) as { token?: unknown };
    validateAdminCredential(body.token);
    const value = createAdminSessionValue();
    return Response.json(
      { ok: true, message: "Write access unlocked for eight hours." },
      {
        headers: {
          "set-cookie": serializeAdminSessionCookie({
            value,
            secure: isSecureRequest(request),
          }),
        },
      }
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Could not unlock writes.",
      },
      { status: getRequestErrorStatus(err, 401) }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    return Response.json(
      { ok: true, message: "Write access locked." },
      {
        headers: {
          "set-cookie": serializeAdminSessionCookie({
            value: "",
            secure: isSecureRequest(request),
            maxAge: 0,
          }),
        },
      }
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Could not lock writes.",
      },
      { status: getRequestErrorStatus(err) }
    );
  }
}
