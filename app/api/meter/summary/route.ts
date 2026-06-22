import { readMeterSamples } from "../../../../lib/meter-store";
import { getRateCardFromEnv, summarizeMeterSamples } from "../../../../lib/metering";
import { validateSpriteNameInput } from "../../../../lib/sprites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const spriteParam = url.searchParams.get("sprite");
    const spriteName = spriteParam ? validateSpriteNameInput(spriteParam) : undefined;

    const samples = await readMeterSamples(spriteName);
    const summary = summarizeMeterSamples(samples, {
      rateCard: getRateCardFromEnv(),
    });

    return Response.json({ ok: true, summary });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not build meter summary.",
      },
      { status: 400 }
    );
  }
}
