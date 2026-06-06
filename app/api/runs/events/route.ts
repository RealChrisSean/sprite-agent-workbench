import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import { recordAgentRunEvent } from "../../../../lib/agent-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as Record<string, unknown>;
    const event = await recordAgentRunEvent(body);

    return Response.json({
      ok: true,
      event,
      message: "Agent run event recorded.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not record run event.",
      },
      { status: 400 }
    );
  }
}
