import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import { createSpriteCheckpoint } from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as {
      spriteName?: unknown;
      comment?: unknown;
    };
    const result = await createSpriteCheckpoint(body.spriteName, body.comment);

    return Response.json({
      ok: true,
      message: result.message,
      checkpointId: result.checkpointId,
      events: result.events,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not create checkpoint.",
      },
      { status: 400 }
    );
  }
}
