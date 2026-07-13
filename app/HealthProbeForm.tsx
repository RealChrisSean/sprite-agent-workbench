"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function HealthProbeForm({
  spriteName,
  canWrite,
  defaultPath = "/",
  defaultExpectedStatuses = "200-399",
}: {
  spriteName: string;
  canWrite: boolean;
  defaultPath?: string;
  defaultExpectedStatuses?: string;
}) {
  const router = useRouter();
  const [path, setPath] = useState(defaultPath);
  const [expectedStatuses, setExpectedStatuses] = useState(
    defaultExpectedStatuses
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function probe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/sprites/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spriteName, path, expectedStatuses }),
      });
      const body = (await response.json()) as {
        message?: string;
        result?: { label?: string };
      };
      if (!response.ok) throw new Error(body.message || "Probe failed.");
      setMessage(body.result?.label || "Probe recorded.");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="mt-4 border-t border-current/15 pt-4" onSubmit={probe}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label>
          <span className="text-xs font-bold uppercase opacity-70">Path</span>
          <input
            className="mt-1 w-full rounded-md border border-current/20 bg-white px-3 py-2 text-sm text-slate-950 outline-none"
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className="text-xs font-bold uppercase opacity-70">
            Expected status
          </span>
          <input
            className="mt-1 w-full rounded-md border border-current/20 bg-white px-3 py-2 text-sm text-slate-950 outline-none"
            placeholder="200-399,404"
            value={expectedStatuses}
            onChange={(event) => setExpectedStatuses(event.currentTarget.value)}
          />
        </label>
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          disabled={!canWrite || isPending}
          type="submit"
        >
          {isPending ? "Probing..." : canWrite ? "Probe now" : "Locked"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 opacity-75">
        This sends an explicit GET and may wake the Sprite. A matching 404 can
        be valid when the configured route intentionally returns 404.
      </p>
      {message ? <p className="mt-2 text-xs font-bold">Recorded: {message}</p> : null}
      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
    </form>
  );
}
