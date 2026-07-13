"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CollectNowButton({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function collect() {
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/observe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as {
        message?: string;
        result?: { spriteCount?: number; checkpointEventsRecorded?: number };
      };
      if (!response.ok) throw new Error(body.message || "Collection failed.");
      setMessage(
        `Collected ${body.result?.spriteCount ?? 0} Sprites · ${body.result?.checkpointEventsRecorded ?? 0} new checkpoint events`
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-100 transition hover:border-slate-500 disabled:opacity-50"
        disabled={!canWrite || isPending}
        type="button"
        onClick={collect}
      >
        {isPending ? "Collecting..." : canWrite ? "Collect now" : "Collection locked"}
      </button>
      {message ? <span className="text-xs text-emerald-300">{message}</span> : null}
      {error ? <span className="text-xs text-red-300">{error}</span> : null}
    </div>
  );
}
