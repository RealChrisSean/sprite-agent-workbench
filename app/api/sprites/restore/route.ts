import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import {
  buildRestorePerformedEventInput,
  recordAgentRunEvent,
} from "../../../../lib/agent-runs";
import {
  restoreSpriteCheckpoint,
  validateCheckpointIdInput,
  validateSpriteNameInput,
} from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as {
      spriteName?: unknown;
      checkpointId?: unknown;
      confirmSpriteName?: unknown;
      acknowledgeOverwrite?: unknown;
      createSafetyCheckpoint?: unknown;
    };
    const spriteName = validateSpriteNameInput(body.spriteName);
    const checkpointId = validateCheckpointIdInput(body.checkpointId);
    const confirmSpriteName = validateSpriteNameInput(body.confirmSpriteName);

    if (confirmSpriteName !== spriteName) {
      throw new Error("Confirmation must exactly match the Sprite name.");
    }
    if (body.acknowledgeOverwrite !== true) {
      throw new Error("Confirm that this restore overwrites current filesystem state.");
    }
    if (body.createSafetyCheckpoint === true) {
      throw new Error(
        "Safety checkpoint creation before restore is disabled until secret snapshot policy is explicit."
      );
    }

    const result = await restoreSpriteCheckpoint(spriteName, checkpointId);

    let runEventId: string | null = null;
    let runEventError: string | null = null;
    try {
      const runEvent = await recordAgentRunEvent(
        buildRestorePerformedEventInput({
          spriteName,
          checkpointId: result.checkpointId,
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
          err instanceof Error ? err.message : "Could not restore checkpoint.",
      },
      { status: 400 }
    );
  }
}
