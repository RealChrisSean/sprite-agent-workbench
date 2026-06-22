import {
  assertJsonRequest,
  assertSameOriginRequest,
} from "../../../../lib/request-security";
import { recordMeterSample } from "../../../../lib/meter-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    assertJsonRequest(request);

    const body = (await request.json()) as unknown;
    const sample = await recordMeterSample(body);

    return Response.json({
      ok: true,
      sample,
      message: "Meter sample recorded.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not record meter sample.",
      },
      { status: 400 }
    );
  }
}
