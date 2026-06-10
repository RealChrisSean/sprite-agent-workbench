"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

const EVENT_OPTIONS = [
  { value: "run_started", label: "Run started" },
  { value: "checkpoint_created", label: "Checkpoint created" },
  { value: "command_started", label: "Command started" },
  { value: "command_finished", label: "Command finished" },
  { value: "file_changed", label: "File changed" },
  { value: "run_failed", label: "Run failed" },
  { value: "run_completed", label: "Run completed" },
] as const;

export function AgentRunEventForm({ spriteName }: { spriteName: string }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof EVENT_OPTIONS)[number]["value"]>(
    "run_started"
  );
  const [runId, setRunId] = useState("");
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function recordEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
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

      <div className="mt-3 flex justify-end">
        <button
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Recording..." : "Record event"}
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
