"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

const EVENT_OPTIONS = [
  { value: "run_started", label: "Run started" },
  { value: "checkpoint_created", label: "Checkpoint created" },
  { value: "restore_performed", label: "Restore performed" },
  { value: "command_started", label: "Command started" },
  { value: "command_finished", label: "Command finished" },
  { value: "file_changed", label: "File changed" },
  { value: "run_failed", label: "Run failed" },
  { value: "run_completed", label: "Run completed" },
] as const;

export function AgentRunEventForm({
  spriteName,
  canWrite,
}: {
  spriteName: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof EVENT_OPTIONS)[number]["value"]>(
    "run_started"
  );
  const [runId, setRunId] = useState("");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [filesText, setFilesText] = useState("");
  const [diffStat, setDiffStat] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function recordEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      const filePayload =
        type === "file_changed"
          ? {
              files: parseChangedFiles(filesText),
              diffStat,
            }
          : {};
      const res = await fetch("/api/runs/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spriteName,
          type,
          runId,
          label,
          summary,
          ...filePayload,
        }),
      });
      const body = (await res.json()) as {
        event?: { runId?: string };
        message?: string;
      };

      if (!res.ok) {
        throw new Error(body.message || "Could not record run event.");
      }

      setRunId(body.event?.runId || runId);
      setLabel("");
      setSummary("");
      setFilesText("");
      setDiffStat("");
      setMessage(
        body.event?.runId
          ? `Recorded event on ${body.event.runId}. Refreshing timeline...`
          : "Recorded event. Refreshing timeline..."
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={recordEvent}>
      <div className="grid gap-3 lg:grid-cols-[0.9fr_1fr]">
        <label>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            Event type
          </span>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
            value={type}
            onChange={(event) =>
              setType(
                event.currentTarget
                  .value as (typeof EVENT_OPTIONS)[number]["value"]
              )
            }
          >
            {EVENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            Run id
          </span>
          <input
            className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
            maxLength={96}
            placeholder="Optional. Reuse to group events."
            value={runId}
            onChange={(event) => setRunId(event.currentTarget.value)}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
          Label
        </span>
        <input
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
          maxLength={120}
          placeholder="Optional. Example: npm install finished"
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
          Summary
        </span>
        <textarea
          className="mt-2 min-h-24 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
          maxLength={500}
          placeholder="What happened? Do not paste secrets, raw tokens, or env values."
          value={summary}
          onChange={(event) => setSummary(event.currentTarget.value)}
        />
      </label>

      {type === "file_changed" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Changed files
            </span>
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs leading-5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
              placeholder={"Paste git diff --name-status lines:\nM\tapp/page.tsx\nA\tlib/example.ts\nD\told/file.ts"}
              value={filesText}
              onChange={(event) => setFilesText(event.currentTarget.value)}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Diff stat
            </span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-lime-500 focus:ring-4 focus:ring-lime-200"
              maxLength={160}
              placeholder="Optional. 4 files changed, 120 insertions(+)"
              value={diffStat}
              onChange={(event) => setDiffStat(event.currentTarget.value)}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Secret-like paths are redacted server-side before storage.
            </p>
          </label>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending || !canWrite}
          type="submit"
        >
          {isPending
            ? "Recording..."
            : canWrite
              ? "Record event"
              : "Write access locked"}
        </button>
      </div>

      {message ? (
        <p className="mt-3 rounded-2xl bg-lime-50 p-3 text-sm font-bold text-lime-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-900">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function parseChangedFiles(text: string): Array<{ status: string; path: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([AMD])\s+(.+)$/);
      if (!match) {
        throw new Error(
          "Changed file lines must look like: M app/page.tsx"
        );
      }
      return {
        status: match[1],
        path: match[2],
      };
    });
}
