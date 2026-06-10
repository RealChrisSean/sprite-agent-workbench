import { assertSameOriginRequest } from "../../../../lib/request-security";
import { getAuthSourceLabel } from "../../../../lib/sprite-auth";
import { testSpriteConnection } from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const result = await testSpriteConnection();
    const spritesText = `${result.total} Sprite${result.total === 1 ? "" : "s"} visible`;

    return Response.json({
      ok: true,
      message: `Connected to ${result.orgName || "your account"} via ${getAuthSourceLabel(result.source)}. ${spritesText}.`,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Connection test failed.",
      },
      { status: 400 }
    );
  }
}
