import {
  assertAdminRequest,
  assertJsonRequest,
  getRequestErrorStatus,
} from "@/lib/request-security";
import { runSpriteHealthProbe } from "@/lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertAdminRequest(request);
    assertJsonRequest(request);
    const body = (await request.json()) as {
      spriteName?: unknown;
      path?: unknown;
      expectedStatuses?: unknown;
    };
    const result = await runSpriteHealthProbe({
      spriteName: body.spriteName,
      path: body.path,
      expectedStatuses: body.expectedStatuses,
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Health probe failed.",
      },
      { status: getRequestErrorStatus(err) }
    );
  }
}
