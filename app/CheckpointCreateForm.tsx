"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function CheckpointCreateForm({ spriteName }: { spriteName: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function createCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/sprites/checkpoints", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spriteName,
          comment,
        }),
      });
      const body = (await res.json()) as {
        checkpointId?: string | null;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(body.message || "Could not create checkpoint.");
      }

      setComment("");
      setMessage(
        body.checkpointId
          ? `Created checkpoint ${body.checkpointId}. Refreshing timeline...`
          : `${body.message || "Checkpoint created."} Refreshing timeline...`
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
      onSubmit={createCheckpoint}
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
        <label className="min-w-0 flex-1">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            New restore point
          </span>
          <input
            className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-lime-300 focus:ring-4 focus:ring-lime-300/20"
            maxLength={240}
            placeholder="Optional comment, e.g. before dependency upgrade"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
          />
        </label>
        <button
          className="rounded-full bg-lime-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Creating..." : "Create checkpoint"}
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        This snapshots the selected Sprite filesystem. Avoid doing this right
        after saving secret-bearing files unless you mean to preserve them.
      </p>
      {message ? (
        <p className="mt-3 rounded-2xl bg-lime-300/10 p-3 text-sm font-bold text-lime-100">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-2xl bg-red-950/70 p-3 text-sm font-bold text-red-100">
          {error}
        </p>
      ) : null}
    </form>
  );
}
