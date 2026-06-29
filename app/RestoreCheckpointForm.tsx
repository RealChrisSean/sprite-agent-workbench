"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function RestoreCheckpointForm({
  spriteName,
  checkpointId,
  overwriteEventCount = 0,
  overwriteFileCount = 0,
}: {
  spriteName: string;
  checkpointId: string;
  overwriteEventCount?: number;
  overwriteFileCount?: number;
}) {
  const router = useRouter();
  const [confirmSpriteName, setConfirmSpriteName] = useState("");
  const [acknowledgeOverwrite, setAcknowledgeOverwrite] = useState(false);
  const [createSafetyCheckpoint, setCreateSafetyCheckpoint] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function restoreCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/sprites/restore", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spriteName,
          checkpointId,
          confirmSpriteName,
          acknowledgeOverwrite,
          createSafetyCheckpoint,
        }),
      });
      const body = (await res.json()) as {
        checkpointId?: string | null;
        safetyCheckpointId?: string | null;
        durationMs?: number | null;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(body.message || "Could not restore checkpoint.");
      }

      setConfirmSpriteName("");
      setAcknowledgeOverwrite(false);
      const restoredText = body.checkpointId
        ? `Restored to ${body.checkpointId}.`
        : body.message || "Checkpoint restored.";
      const durationText =
        typeof body.durationMs === "number" && body.durationMs >= 0
          ? ` Restored in ${(body.durationMs / 1000).toFixed(1)}s.`
          : "";
      const safetyText = body.safetyCheckpointId
        ? ` Safety checkpoint ${body.safetyCheckpointId} holds the previous state.`
        : "";
      setMessage(
        `${restoredText}${durationText}${safetyText} Refreshing timeline...`
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const canSubmit =
    confirmSpriteName === spriteName && acknowledgeOverwrite && !isPending;

  return (
    <details className="mt-4 rounded-2xl border border-red-900/50 bg-red-950/20">
      <summary className="cursor-pointer list-none p-3 text-sm font-bold text-red-100 transition hover:text-red-50 [&::-webkit-details-marker]:hidden">
        Restore this checkpoint
        <span className="ml-2 font-normal text-red-200/70">
          Destructive. Requires confirmation.
        </span>
      </summary>
      <form className="space-y-3 px-3 pb-3" onSubmit={restoreCheckpoint}>
        <p className="rounded-2xl border border-red-900/60 bg-red-950/60 p-3 text-xs leading-5 text-red-100">
          This will restore <span className="font-mono">{spriteName}</span> to{" "}
          <span className="font-mono">{checkpointId}</span>. Current filesystem
          changes after that checkpoint can be lost. Workbench records an
          audit event for every restore.
          <br />
          {overwriteEventCount > 0 ? (
            <span className="mt-1 inline-block font-semibold text-red-50">
              Since this checkpoint: {overwriteEventCount} recorded event
              {overwriteEventCount === 1 ? "" : "s"}
              {overwriteFileCount > 0
                ? `, ${overwriteFileCount} file${overwriteFileCount === 1 ? "" : "s"} changed`
                : ""}{" "}
              will be discarded.
            </span>
          ) : (
            <span className="mt-1 inline-block text-red-200/80">
              No recorded Workbench activity since this checkpoint.
            </span>
          )}
        </p>

        <label className="flex items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 text-xs leading-5 text-slate-200">
          <input
            className="mt-1 h-4 w-4 accent-lime-400"
            checked={createSafetyCheckpoint}
            type="checkbox"
            onChange={(event) =>
              setCreateSafetyCheckpoint(event.currentTarget.checked)
            }
          />
          <span>
            <span className="font-bold">
              Create a safety checkpoint first (recommended).
            </span>{" "}
            Snapshots the current state so this restore can be undone. The
            snapshot captures the Sprite&apos;s writable filesystem overlay,
            including any secret-bearing files on disk (for example
            `.env.local`).
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-red-200/80">
            Type Sprite name to confirm
          </span>
          <input
            className="mt-2 w-full rounded-2xl border border-red-900/70 bg-slate-950 px-4 py-3 font-mono text-sm text-red-50 outline-none transition placeholder:text-red-200/30 focus:border-red-300 focus:ring-4 focus:ring-red-300/20"
            placeholder={spriteName}
            value={confirmSpriteName}
            onChange={(event) =>
              setConfirmSpriteName(event.currentTarget.value)
            }
          />
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-red-900/50 bg-slate-950 p-3 text-xs leading-5 text-red-100">
          <input
            className="mt-1 h-4 w-4 accent-red-500"
            checked={acknowledgeOverwrite}
            type="checkbox"
            onChange={(event) =>
              setAcknowledgeOverwrite(event.currentTarget.checked)
            }
          />
          <span>
            I understand this can overwrite current state and should only be
            used when this checkpoint is the safest rollback point.
          </span>
        </label>

        <button
          className="rounded-full bg-red-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSubmit}
          type="submit"
        >
          {isPending ? "Restoring..." : `Restore ${checkpointId}`}
        </button>

        {message ? (
          <p className="rounded-2xl bg-lime-300/10 p-3 text-sm font-bold text-lime-100">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-2xl bg-red-950/70 p-3 text-sm font-bold text-red-100">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
