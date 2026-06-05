import {
  formatDate,
  getDashboardData,
  type DashboardSprite,
  type SleepInference,
} from "@/lib/sprites";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#d9f99d_0,#f8fafc_28rem,#e5e7eb_100%)] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex rounded-full border border-lime-300 bg-lime-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-lime-900">
              Sprite Agent Workbench
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
              See why your Sprites are awake, cold, or ready to restore.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
              A local dashboard for anyone using Sprites. It reads your
              authenticated Sprite CLI, lists every Sprite, tracks checkpoint
              history, and explains cold state with evidence instead of vibes.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-sm text-lime-100 shadow-xl">
            <p className="text-slate-400">Last refresh</p>
            <p className="mt-1 font-mono text-lg">{formatDate(data.fetchedAt)}</p>
            <Link
              className="mt-4 inline-flex rounded-full bg-lime-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-lime-200"
              href="/"
            >
              Refresh now
            </Link>
          </div>
        </header>

        {!data.ok ? (
          <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-950">
            <h2 className="text-2xl font-black">Sprite CLI is not ready</h2>
            <p className="mt-2 text-red-800">{data.error?.message}</p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-red-950 p-4 text-sm text-red-50">
              {data.error?.hint}
            </pre>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Org" value={data.orgName || "Unknown"} detail="Current Sprite account" />
              <MetricCard label="Sprites" value={String(data.counts.total)} detail="Visible to this account" />
              <MetricCard
                label="Running / Warm"
                value={`${data.counts.running} / ${data.counts.warm}`}
                detail={`Limits: ${data.counts.runningLimit ?? "-"} running, ${data.counts.warmLimit ?? "-"} warm`}
              />
              <MetricCard label="Cold" value={String(data.counts.cold)} detail="Likely asleep or idle" />
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              {data.sprites.map((sprite) => (
                <SpriteCard key={sprite.id} sprite={sprite} />
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm backdrop-blur">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 truncate text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function SpriteCard({ sprite }: { sprite: DashboardSprite }) {
  return (
    <article className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">
                {sprite.name}
              </h2>
              <StatusPill status={sprite.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{sprite.organization}</p>
          </div>
          {sprite.url ? (
            <a
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              href={sprite.url}
              target="_blank"
              rel="noreferrer"
            >
              Open app
            </a>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Info label="URL auth" value={sprite.url_settings?.auth || "unknown"} />
          <Info label="Last running" value={formatDate(sprite.last_running_at)} />
          <Info label="Last warming" value={formatDate(sprite.last_warming_at)} />
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <SleepBox sleep={sprite.sleep} />
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Health check
            </p>
            <p className="mt-2 text-lg font-black text-slate-950">
              {sprite.health.label}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {sprite.health.detail}
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">
                Checkpoints
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Latest restore points from Sprites
              </p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-bold">
              {sprite.checkpoints.length}
            </span>
          </div>
          {sprite.checkpointError ? (
            <p className="rounded-2xl bg-red-950/70 p-3 text-sm text-red-100">
              {sprite.checkpointError}
            </p>
          ) : (
            <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {sprite.checkpoints.slice(0, 12).map((checkpoint) => (
                <li
                  key={`${sprite.name}-${checkpoint.id}`}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-bold text-lime-200">
                      {checkpoint.id}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDate(checkpoint.create_time)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {checkpoint.comment || "No comment"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-slate-950">{value}</p>
    </div>
  );
}

function SleepBox({ sleep }: { sleep: SleepInference }) {
  const tone =
    sleep.tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : sleep.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-slate-200 bg-slate-50 text-slate-950";

  return (
    <div className={`rounded-3xl border p-4 ${tone}`}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">
        Why this state?
      </p>
      <p className="mt-2 text-xl font-black">{sleep.label}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {sleep.evidence.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === "running"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : status === "warm"
        ? "bg-lime-100 text-lime-900 border-lime-200"
        : status === "cold"
          ? "bg-slate-100 text-slate-700 border-slate-200"
          : "bg-amber-100 text-amber-900 border-amber-200";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${classes}`}>
      {status}
    </span>
  );
}
