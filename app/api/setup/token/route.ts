import {
  deleteSavedSpriteApiToken,
  saveSavedSpriteApiToken,
  validateTokenInput,
} from "../../../../lib/sprite-auth";
import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import { validateSpritesApiToken } from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as { token?: unknown };
    const token = validateTokenInput(body.token);

    await validateSpritesApiToken(token);
    saveSavedSpriteApiToken(token);

    return Response.json({
      ok: true,
      message: "Token saved server-side.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Could not save token.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    deleteSavedSpriteApiToken();

    return Response.json({
      ok: true,
      message: "Saved fallback token deleted.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err instanceof Error ? err.message : "Could not delete token.",
      },
      { status: 400 }
    );
  }
}
