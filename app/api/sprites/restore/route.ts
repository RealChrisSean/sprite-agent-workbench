import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import {
  buildCheckpointCreatedEventInput,
  buildRestorePerformedEventInput,
  recordAgentRunEvent,
} from "../../../../lib/agent-runs";
import {
  createSpriteCheckpoint,
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
    if (
      body.createSafetyCheckpoint !== true &&
      body.createSafetyCheckpoint !== false
    ) {
      throw new Error(
        "Choose whether to create a safety checkpoint before restoring."
      );
    }

    // The safety checkpoint snapshots the Sprite's writable filesystem
    // overlay, including any secret-bearing files on disk. The UI states this
    // next to the opt-out, so a true here is informed consent per restore.
    let safetyCheckpointId: string | null = null;
    if (body.createSafetyCheckpoint === true) {
      const safetyComment = `Safety checkpoint before restore to ${checkpointId}`;
      const safety = await createSpriteCheckpoint(spriteName, safetyComment);
      safetyCheckpointId = safety.checkpointId;
      try {
        await recordAgentRunEvent(
          buildCheckpointCreatedEventInput({
            spriteName,
            checkpointId: safety.checkpointId,
            comment: safetyComment,
            message: safety.message,
          })
        );
      } catch {
        // The restore should not fail because the audit event could not be
        // written; the restore event below carries the safety checkpoint id.
      }
    }

    // Time only the restore itself; the optional safety checkpoint above is
    // separately auditable and should not inflate the reported restore time.
    const startedAt = Date.now();
    const result = await restoreSpriteCheckpoint(spriteName, checkpointId);
    const durationMs = Date.now() - startedAt;

    let runEventId: string | null = null;
    let runEventError: string | null = null;
    try {
      const runEvent = await recordAgentRunEvent(
        buildRestorePerformedEventInput({
          spriteName,
          checkpointId: result.checkpointId,
          message: result.message,
          safetyCheckpointId,
          durationMs,
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
      safetyCheckpointId,
      durationMs,
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
