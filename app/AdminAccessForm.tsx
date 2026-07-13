"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function AdminAccessForm({
  configured,
  unlocked,
}: {
  configured: boolean;
  unlocked: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Unlock failed.");
      setToken("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function lock() {
    setError(null);
    try {
      const response = await fetch("/api/admin/session", { method: "DELETE" });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "Lock failed.");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!configured) {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">
        Read-only · admin token not configured
      </span>
    );
  }

  if (unlocked) {
    return (
      <button
        className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60"
        disabled={isPending}
        type="button"
        onClick={lock}
      >
        {isPending ? "Locking..." : "Writes unlocked · Lock"}
      </button>
    );
  }

  return (
    <form className="flex flex-wrap items-center justify-end gap-2" onSubmit={unlock}>
      <input
        aria-label="Workbench admin token"
        className="w-44 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-950"
        placeholder="Admin token"
        type="password"
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
      />
      <button
        className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
        disabled={isPending || !token}
        type="submit"
      >
        {isPending ? "Unlocking..." : "Unlock writes"}
      </button>
      {error ? <span className="basis-full text-right text-xs text-red-700">{error}</span> : null}
    </form>
  );
}
