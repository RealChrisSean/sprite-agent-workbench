"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function TokenFallbackForm({
  hasSavedToken,
}: {
  hasSavedToken: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!acceptedRisk) {
      setError("Confirm the checkpoint risk before using fallback storage.");
      return;
    }

    try {
      const res = await fetch("/api/setup/token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json()) as { message?: string };

      if (!res.ok) {
        throw new Error(body.message || "Could not save token.");
      }

      setToken("");
      setAcceptedRisk(false);
      setMessage("Token saved on the server. Refreshing dashboard...");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteToken() {
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/setup/token", {
        method: "DELETE",
      });
      const body = (await res.json()) as { message?: string };

      if (!res.ok) {
        throw new Error(body.message || "Could not delete token.");
      }

      setMessage("Saved fallback token deleted. Refreshing dashboard...");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
            Fallback
          </p>
          <h3 className="mt-2 text-2xl font-black">
            Paste a token only if you accept the checkpoint risk.
          </h3>
        </div>
        {hasSavedToken ? (
          <button
            className="rounded-full border border-amber-400 px-4 py-2 text-sm font-black transition hover:bg-amber-100 disabled:opacity-60"
            disabled={isPending}
            type="button"
            onClick={deleteToken}
          >
            Delete saved token
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-amber-900">
        This stores the token server-side only, outside the repo, with file mode
        600. It does not put the token in localStorage, cookies, URLs, frontend
        code, or git. But it can still be captured by filesystem snapshots if
        you checkpoint the Sprite after saving it.
      </p>

      <form className="mt-5 space-y-4" onSubmit={submitToken}>
        <label className="block">
          <span className="text-sm font-black">Sprites API token</span>
          <input
            className="mt-2 w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-amber-600 focus:ring-4 focus:ring-amber-200"
            placeholder="Paste token here"
            type="password"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
        </label>

        <label className="flex gap-3 rounded-2xl border border-amber-300 bg-white/60 p-3 text-sm leading-6">
          <input
            checked={acceptedRisk}
            className="mt-1 h-4 w-4 shrink-0"
            type="checkbox"
            onChange={(event) => setAcceptedRisk(event.currentTarget.checked)}
          />
          <span>
            I understand this fallback stores a long-lived token on this server
            and may be captured if I create filesystem checkpoints afterward.
          </span>
        </label>

        <button
          className="rounded-full bg-amber-500 px-5 py-3 text-sm font-black text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending || !token.trim()}
          type="submit"
        >
          Save fallback token
        </button>
      </form>

      {message ? (
        <p className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
