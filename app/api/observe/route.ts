import {
  assertAdminOrIngestRequest,
  assertJsonRequest,
  getRequestErrorStatus,
} from "@/lib/request-security";
import { observeSpriteFleet } from "@/lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertAdminOrIngestRequest(request);
    assertJsonRequest(request);
    await request.json();
    const result = await observeSpriteFleet();
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Collection failed.",
      },
      { status: getRequestErrorStatus(err) }
    );
  }
}
