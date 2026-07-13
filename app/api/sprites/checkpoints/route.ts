import {
  assertAdminRequest,
  assertJsonRequest,
  getRequestErrorStatus,
} from "../../../../lib/request-security";
import {
  buildCheckpointCreatedEventInput,
  recordAgentRunEvent,
} from "../../../../lib/agent-runs";
import {
  createSpriteCheckpoint,
  validateCheckpointCommentInput,
  validateSpriteNameInput,
} from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertAdminRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as {
      spriteName?: unknown;
      comment?: unknown;
    };
    const spriteName = validateSpriteNameInput(body.spriteName);
    const comment = validateCheckpointCommentInput(body.comment);
    const result = await createSpriteCheckpoint(spriteName, comment);

    let runEventId: string | null = null;
    let runEventError: string | null = null;
    try {
      const runEvent = await recordAgentRunEvent(
        buildCheckpointCreatedEventInput({
          spriteName,
          checkpointId: result.checkpointId,
          comment,
          message: result.message,
        })
      );
      runEventId = runEvent.id;
    } catch (eventErr) {
      runEventError =
        eventErr instanceof Error ? eventErr.message : String(eventErr);
    }

    return Response.json({
      ok: true,
      message: result.message,
      checkpointId: result.checkpointId,
      runEventId,
      runEventError,
      events: result.events,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not create checkpoint.",
      },
      { status: getRequestErrorStatus(err) }
    );
  }
}
