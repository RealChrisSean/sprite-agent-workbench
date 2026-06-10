"use client";

import { useState } from "react";

export function TestConnectionButton() {
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function testConnection() {
    setIsPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/setup/test-connection", {
        method: "POST",
      });
      const body = (await res.json()) as { message?: string };
      setResult({
        ok: res.ok,
        message:
          body.message ||
          (res.ok ? "Connected." : "Connection test failed."),
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-wait disabled:opacity-60"
        disabled={isPending}
        type="button"
        onClick={testConnection}
      >
        {isPending ? "Testing..." : "Test connection"}
      </button>
      {result ? (
        <p
          className={`rounded-2xl p-3 text-sm font-semibold ${
            result.ok
              ? "bg-emerald-50 text-emerald-900"
              : "bg-red-50 text-red-900"
          }`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
