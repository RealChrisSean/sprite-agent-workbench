import {
  getAgentRunTimeline,
  getCheckpointContextEvents,
  getEventsSinceCheckpoint,
  type AgentRunEvent,
  type AgentRunFileChange,
  type AgentRunGroup,
  type AgentRunTimeline,
} from "@/lib/agent-runs";
import {
  getDashboardData,
  getSpriteDashboardUrl,
  getSpriteRuntimeEvidence,
  isRestorableCheckpoint,
  type DashboardSprite,
  type SleepInference,
  type SpriteCheckpoint,
  type SpriteRuntimeEvidence,
} from "@/lib/sprites";
import {
  ADMIN_SESSION_COOKIE,
  getAdminToken,
  verifyAdminSessionValue,
} from "@/lib/admin-auth";
import { readMeterSamples } from "@/lib/meter-store";
import {
  getRateCardFromEnv,
  summarizeMeterSamples,
  type MeterSummary,
} from "@/lib/metering";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { AdminAccessForm } from "../../AdminAccessForm";
import { AgentRunEventForm } from "../../AgentRunEventForm";
import { CheckpointCreateForm } from "../../CheckpointCreateForm";
import { HealthProbeForm } from "../../HealthProbeForm";
import { LocalTime } from "../../LocalTime";
import { RefreshButton } from "../../RefreshButton";
import { RestoreCheckpointForm } from "../../RestoreCheckpointForm";
import { SpriteCheckpointSelect } from "../../SpriteCheckpointSelect";
import { StatusPill } from "../../StatusPill";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} · Sprite Agent Workbench` };
}

export default async function SpriteDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const spriteName = decodeURIComponent(name);
  const headerStore = await headers();
  const selfHost =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const data = await getDashboardData(spriteName, { selfHost });
  const sprite = data.ok
    ? (data.sprites.find((item) => item.name === spriteName) ?? null)
    : null;
  const [timeline, meterSamples, runtimeEvidence] = sprite
    ? await Promise.all([
        getAgentRunTimeline(sprite.name),
        readMeterSamples(sprite.name),
        getSpriteRuntimeEvidence(sprite.name),
      ])
    : [null, [], null];
  const meterSummary = sprite
    ? summarizeMeterSamples(meterSamples, { rateCard: getRateCardFromEnv() })
    : null;
  const cookieStore = await cookies();
  const adminAccess = {
    configured: Boolean(getAdminToken()),
    unlocked: verifyAdminSessionValue(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value
    ),
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#d9f99d_0,#f8fafc_28rem,#e5e7eb_100%)] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
        <header className="rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <Link
                className="text-sm font-semibold text-slate-600 underline-offset-2 transition hover:text-slate-950 hover:underline"
                href="/"
              >
                &larr; Fleet overview
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="break-words text-3xl font-black tracking-tight text-slate-950">
                  {sprite ? sprite.name : spriteName}
                </h1>
                {sprite ? <StatusPill status={sprite.status} /> : null}
              </div>
              {sprite ? (
                <p className="mt-1 text-sm text-slate-500">
                  {sprite.organization}
                </p>
              ) : null}
            </div>

            {sprite ? (
              <div className="flex flex-col items-start gap-3 md:items-end">
                <div className="flex flex-wrap gap-2">
                  <AdminAccessForm {...adminAccess} />
                  <a
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    href={getSpriteDashboardUrl(sprite)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage in Sprites
                  </a>
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
                  <RefreshButton />
                </div>
                <SpriteCheckpointSelect
                  selectedName={sprite.name}
                  options={data.sprites.map((item) => ({
                    name: item.name,
                    status: item.status,
                  }))}
                />
              </div>
            ) : null}
          </div>

          {sprite ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Info
                label="URL auth"
                value={sprite.url_settings?.auth || "unknown"}
              />
              <Info
                label="Last running"
                value={<LocalTime iso={sprite.last_running_at} />}
              />
              <Info
                label="Last warming"
                value={<LocalTime iso={sprite.last_warming_at} />}
              />
            </div>
          ) : null}
        </header>

        {!data.ok ? (
          <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-950">
            <h2 className="text-xl font-bold">Sprite data is not ready</h2>
            <p className="mt-2 text-red-800">{data.error?.message}</p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-red-950 p-4 text-sm text-red-50">
              {data.error?.hint}
            </pre>
            <Link
              className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              href="/"
            >
              Back to fleet overview
            </Link>
          </section>
        ) : !sprite ? (
          <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-amber-950">
            <h2 className="text-xl font-bold">
              No Sprite named &quot;{spriteName}&quot; is visible to this
              account.
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              It may have been destroyed or renamed, or it belongs to another
              organization.
            </p>
            <Link
              className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              href="/"
            >
              Back to fleet overview
            </Link>
          </section>
        ) : (
          <>
            <SleepBox
              spriteName={sprite.name}
              sleep={sprite.sleep}
              health={sprite.health}
              canWrite={adminAccess.unlocked}
            />

            {runtimeEvidence ? (
              <RuntimeEvidencePanel evidence={runtimeEvidence} />
            ) : null}

            {meterSummary ? <MeterPanel summary={meterSummary} /> : null}

            <CheckpointsPanel
              sprite={sprite}
              timeline={timeline}
              canWrite={adminAccess.unlocked}
            />

            {timeline ? (
              <AgentRunTimelinePanel
                sprite={sprite}
                timeline={timeline}
                canWrite={adminAccess.unlocked}
              />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function CheckpointsPanel({
  sprite,
  timeline,
  canWrite,
}: {
  sprite: DashboardSprite;
  timeline: AgentRunTimeline | null;
  canWrite: boolean;
}) {
  const restorableCheckpoints = sprite.checkpoints.filter(
    isRestorableCheckpoint
  );
  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 text-slate-100 shadow-[0_24px_90px_rgba(15,23,42,0.20)]">
      <div className="border-b border-slate-800 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-lime-300">
              Checkpoints
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight">
              Restore points and their context
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span>{restorableCheckpoints.length} restore points</span>
            <span>
              Last running <LocalTime iso={sprite.last_running_at} />
            </span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4">
          <CheckpointCreateForm spriteName={sprite.name} canWrite={canWrite} />
        </div>

        {sprite.checkpointError ? (
          <p className="rounded-2xl bg-red-950/70 p-4 text-sm text-red-100">
            {sprite.checkpointError}
          </p>
        ) : restorableCheckpoints.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
            No checkpoints found for this Sprite yet.
          </p>
        ) : (
          <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {restorableCheckpoints.map((checkpoint) => {
              const overwrite = timeline
                ? getEventsSinceCheckpoint(
                    timeline.events,
                    checkpoint.create_time
                  )
                : { eventCount: 0, fileCount: 0, events: [] };
              return (
                <CheckpointListItem
                  key={`${sprite.name}-${checkpoint.id}`}
                  spriteName={sprite.name}
                  checkpoint={checkpoint}
                  contextEvents={
                    timeline
                      ? getCheckpointContextEvents(
                          timeline.events,
                          checkpoint.id
                        )
                      : []
                  }
                  overwriteEventCount={overwrite.eventCount}
                  overwriteFileCount={overwrite.fileCount}
                  canWrite={canWrite}
                />
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function CheckpointListItem({
  spriteName,
  checkpoint,
  contextEvents,
  overwriteEventCount,
  overwriteFileCount,
  canWrite,
}: {
  spriteName: string;
  checkpoint: SpriteCheckpoint;
  contextEvents: AgentRunEvent[];
  overwriteEventCount: number;
  overwriteFileCount: number;
  canWrite: boolean;
}) {
  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm font-semibold text-lime-200">
          {checkpoint.id}
        </span>
        <span className="text-xs text-slate-500">
          <LocalTime iso={checkpoint.create_time} />
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        {checkpoint.comment || "No comment"}
      </p>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
          Known context
        </p>
        {contextEvents.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-slate-500">
            No linked timeline events yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {contextEvents.map((event) => (
              <li key={event.id} className="text-sm leading-6 text-slate-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold text-lime-100">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${getRunEventDotClass(event.status)}`}
                      aria-hidden="true"
                    />
                    {event.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    <LocalTime iso={event.createdAt} />
                  </span>
                </div>
                {event.summary ? (
                  <p className="mt-1 text-slate-400">{event.summary}</p>
                ) : null}
                {typeof event.metadata.app_health === "string" ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Health label supplied with event:{" "}
                    <span className="font-semibold text-slate-300">
                      {event.metadata.app_health}
                    </span>
                  </p>
                ) : null}
                {typeof event.metadata.health_when_observed === "string" ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Health when discovered:{" "}
                    <span className="font-semibold text-slate-300">
                      {event.metadata.health_when_observed}
                    </span>
                  </p>
                ) : null}
                {event.fileChange ? (
                  <FileChangeSummary fileChange={event.fileChange} compact />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <RestoreCheckpointForm
        spriteName={spriteName}
        checkpointId={checkpoint.id}
        overwriteEventCount={overwriteEventCount}
        overwriteFileCount={overwriteFileCount}
        canWrite={canWrite}
      />
    </li>
  );
}

function AgentRunTimelinePanel({
  sprite,
  timeline,
  canWrite,
}: {
  sprite: DashboardSprite;
  timeline: AgentRunTimeline;
  canWrite: boolean;
}) {
  const latestRun = timeline.runs[0] ?? null;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
              Agent run timeline
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
              What happened inside {sprite.name}?
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Runs, commands, file changes, failures, and checkpoint moments
              recorded for this Sprite.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-72">
            <Info label="Runs" value={String(timeline.runs.length)} />
            <Info label="Events" value={String(timeline.events.length)} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Latest activity
              </p>
              <p className="mt-2 text-lg font-bold text-slate-950">
                {latestRun ? latestRun.title : "No runs yet"}
              </p>
            </div>
            {latestRun ? <RunStatusPill status={latestRun.status} /> : null}
          </div>

          {timeline.runs.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-6 text-slate-600">
              No agent run events have been recorded for this Sprite yet. Seed a
              manual event to test the timeline, or wire an agent runner to
              write here when it starts commands, changes files, or creates a
              checkpoint.
            </div>
          ) : (
            <ol className="mt-4 max-h-[36rem] space-y-4 overflow-y-auto pr-1">
              {timeline.runs.map((run) => (
                <AgentRunGroupItem key={run.runId} run={run} />
              ))}
            </ol>
          )}
        </div>

        <details className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer list-none p-4 text-sm font-bold text-slate-700 transition hover:text-slate-950 [&::-webkit-details-marker]:hidden">
            Seed a manual event
            <span className="ml-2 font-normal text-slate-500">
              For dogfooding. A real agent runner can post to the same route
              later.
            </span>
          </summary>
          <div className="px-4 pb-4">
            <AgentRunEventForm
              spriteName={sprite.name}
              canWrite={canWrite}
            />
          </div>
        </details>
      </div>
    </section>
  );
}

function AgentRunGroupItem({ run }: { run: AgentRunGroup }) {
  return (
    <li className="rounded-3xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-950">
              {run.title}
            </h3>
            <RunStatusPill status={run.status} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">
            {run.runId}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>
            Started <LocalTime iso={run.startedAt} />
          </p>
          <p>
            Updated <LocalTime iso={run.updatedAt} />
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">
        {run.events.map((event) => (
          <AgentRunEventItem key={event.id} event={event} />
        ))}
      </ol>
    </li>
  );
}

function AgentRunEventItem({ event }: { event: AgentRunEvent }) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border-2 border-white ${getRunEventDotClass(event.status)}`}
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-950">{event.label}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
            {event.type.replaceAll("_", " ")}
          </p>
        </div>
        <span className="text-xs text-slate-500">
          <LocalTime iso={event.createdAt} />
        </span>
      </div>
      {event.summary ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">{event.summary}</p>
      ) : null}
      {event.fileChange ? (
        <FileChangeSummary fileChange={event.fileChange} />
      ) : null}
      {Object.keys(event.metadata).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(event.metadata).map(([key, value]) => (
            <span
              key={key}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600"
            >
              {key}: {String(value)}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function FileChangeSummary({
  fileChange,
  compact = false,
}: {
  fileChange: AgentRunFileChange;
  compact?: boolean;
}) {
  const visibleFiles = fileChange.files.slice(0, compact ? 4 : 8);
  const hiddenCount = fileChange.fileCount - visibleFiles.length;

  return (
    <div
      className={
        compact
          ? "mt-2 rounded-2xl border border-slate-800 bg-slate-950 p-3"
          : "mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          {fileChange.fileCount} file
          {fileChange.fileCount === 1 ? "" : "s"} changed
        </p>
        {fileChange.diffStat ? (
          <span className="font-mono text-xs text-slate-500">
            {fileChange.diffStat}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {visibleFiles.map((file, index) => (
          <span
            key={`${file.status}-${file.path}-${index}`}
            className={
              compact
                ? "rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-xs font-semibold text-slate-300"
                : "rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-slate-600"
            }
            title={file.redacted ? "Secret-like path redacted" : file.path}
          >
            {file.status} {file.path}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span
            className={
              compact
                ? "rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-bold text-slate-500"
                : "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-500"
            }
          >
            +{hiddenCount} more
          </span>
        ) : null}
      </div>

      {fileChange.redactedCount > 0 ? (
        <p
          className={
            compact
              ? "mt-2 text-xs text-amber-200"
              : "mt-2 text-xs text-amber-700"
          }
        >
          {fileChange.redactedCount} secret-like path
          {fileChange.redactedCount === 1 ? "" : "s"} redacted before storage.
        </p>
      ) : null}
    </div>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const classes =
    status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : status === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : status === "error"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${classes}`}>
      {status}
    </span>
  );
}

function getRunEventDotClass(status: string) {
  if (status === "success") return "bg-emerald-500";
  if (status === "warning") return "bg-amber-500";
  if (status === "error") return "bg-red-500";
  return "bg-slate-400";
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="truncate text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slate-500" title={label}>
        {label}
      </p>
      <p
        className="mt-1 truncate text-sm font-bold text-slate-950"
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function MeterPanel({ summary }: { summary: MeterSummary }) {
  const usd = (value: number) =>
    value < 0.01 && value > 0 ? `<$0.01` : `$${value.toFixed(2)}`;
  const confidence = {
    high: { label: "High confidence", tone: "border-emerald-300 bg-emerald-50 text-emerald-900" },
    medium: { label: "Medium confidence", tone: "border-amber-300 bg-amber-50 text-amber-900" },
    low: { label: "Low confidence", tone: "border-red-300 bg-red-50 text-red-900" },
    "counter-only": { label: "Counter data only · interval coverage missing", tone: "border-slate-300 bg-slate-100 text-slate-700" },
  }[summary.confidence];

  const empty = summary.sampleCount < 2;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
              Local usage estimate
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
              Counter-based estimate, not invoice data
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              CPU and memory start with local cgroup counters. The estimate
              applies the published 6.25% CPU and 0.25 GB memory floors;
              counter resets and missing intervals remain explicit uncertainty.
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${confidence.tone}`}>
            {confidence.label}
          </span>
        </div>
      </div>

      {empty ? (
        <div className="p-5">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            No meter samples yet. Run the on-Sprite reader to start measuring:
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-lime-200">
{`# inside the Sprite (one sample; no loop)
WORKBENCH_URL=<url> WORKBENCH_INGEST_TOKEN=<secret> \\
  SPRITE_NAME=${summary.spriteName ?? "<sprite>"} node scripts/sprite-meter.mjs

# local demo (no cgroup needed)
METER_SOURCE=synthetic WORKBENCH_INGEST_TOKEN=<secret> \\
  SPRITE_NAME=${summary.spriteName ?? "<sprite>"} node scripts/sprite-meter.mjs`}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">
              Counter-based estimate so far
            </p>
            <p className="mt-2 text-4xl font-black tracking-tight text-white">
              {usd(summary.cost.total)}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              over {summary.sampleCount} samples ·{" "}
              {(summary.spanMs / 3_600_000).toFixed(2)}h span ·{" "}
              {Math.round(summary.coverage * 100)}% integrated coverage
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MeterStat label="CPU estimate" usage={`${summary.cpuHours.toFixed(3)} CPU-hr billed · ${summary.rawCpuHours.toFixed(3)} raw`} cost={usd(summary.cost.cpu)} />
            <MeterStat label="Memory" usage={`${summary.memoryGbHours.toFixed(3)} GB-hr`} cost={usd(summary.cost.memory)} />
            <MeterStat label="Hot storage proxy" usage={`${summary.hotStorageGbHours.toFixed(3)} GB-hr`} cost={usd(summary.cost.hotStorage)} />
            <MeterStat label="Cold storage proxy" usage={`${summary.coldStorageGbHours.toFixed(3)} GB-hr`} cost={usd(summary.cost.coldStorage)} />
          </div>

          {summary.notes.length > 0 ? (
            <ul className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              {summary.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span aria-hidden="true">!</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs leading-5 text-slate-500">
            Local estimate at published rates{" "}
            ${summary.rateCard.cpuPerHour}/CPU-hr, ${summary.rateCard.memoryGbPerHour}/GB-hr.
            Storage from <code className="font-mono">du</code>, when enabled, is
            only a directory-size scenario proxy and does not reproduce the
            platform hot-cache or object-storage meters.
          </p>
        </div>
      )}
    </section>
  );
}

function MeterStat({
  label,
  usage,
  cost,
}: {
  label: string;
  usage: string;
  cost: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slate-500">
          {label}
        </p>
      </div>
      <p className="mt-2 text-lg font-black text-slate-950">{cost}</p>
      <p className="mt-0.5 text-xs text-slate-500">{usage}</p>
    </div>
  );
}

function RuntimeEvidencePanel({
  evidence,
}: {
  evidence: SpriteRuntimeEvidence;
}) {
  const tone =
    evidence.assessment.tone === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : evidence.assessment.tone === "good"
        ? "border-emerald-300 bg-emerald-50 text-emerald-950"
        : "border-slate-300 bg-white text-slate-950";

  return (
    <section className={`rounded-[2rem] border p-5 ${tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-65">
            Awake evidence
          </p>
          <h2 className="mt-2 text-xl font-bold">{evidence.assessment.label}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-80">
            {evidence.assessment.detail}
          </p>
        </div>
        <p className="text-xs opacity-65">
          Control plane read <LocalTime iso={evidence.fetchedAt} />
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-current/15 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Services</h3>
            <span className="text-xs opacity-65">
              {evidence.runningServiceCount} running
            </span>
          </div>
          {evidence.services.length === 0 ? (
            <p className="mt-3 text-sm opacity-65">No Services returned.</p>
          ) : (
            <ul className="mt-3 divide-y divide-current/10">
              {evidence.services.map((service) => (
                <li key={service.name} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">
                      {service.name}
                    </span>
                    <span className="text-xs font-bold uppercase opacity-65">
                      {service.state}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs opacity-75">
                    {service.command || "Command not returned"}
                  </p>
                  <p className="mt-1 text-xs opacity-65">
                    PID {service.pid ?? "-"} · HTTP {service.httpPort ?? "-"} ·
                    started <LocalTime iso={service.startedAt} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-current/15 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Exec sessions</h3>
            <span className="text-xs opacity-65">
              {evidence.activeSessionCount} active
            </span>
          </div>
          {evidence.sessions.length === 0 ? (
            <p className="mt-3 text-sm opacity-65">No exec sessions returned.</p>
          ) : (
            <ul className="mt-3 divide-y divide-current/10">
              {evidence.sessions.map((session) => (
                <li key={session.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">
                      {session.command || session.id}
                    </span>
                    <span className="text-xs font-bold uppercase opacity-65">
                      {session.active ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs opacity-65">
                    Created <LocalTime iso={session.createdAt} /> · last activity{" "}
                    <LocalTime iso={session.lastActivityAt} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {evidence.errors.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-red-800">
          {evidence.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SleepBox({
  spriteName,
  sleep,
  health,
  canWrite,
}: {
  spriteName: string;
  sleep: SleepInference;
  health: DashboardSprite["health"];
  canWrite: boolean;
}) {
  const tone =
    sleep.tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : sleep.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-slate-200 bg-slate-50 text-slate-950";

  return (
    <section className={`rounded-[2rem] border p-5 ${tone}`}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">
        Why this state?
      </p>
      <p className="mt-2 text-base font-bold">{sleep.label}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {sleep.evidence.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-current/15 pt-3 text-sm leading-6 opacity-80">
        <span className="font-bold">Health: {health.label}.</span>{" "}
        {health.detail}
        {health.observedAt ? (
          <span>
            {" "}Recorded <LocalTime iso={health.observedAt} /> for{" "}
            <span className="font-mono">{health.path}</span>.
          </span>
        ) : null}
      </p>
      <HealthProbeForm
        spriteName={spriteName}
        canWrite={canWrite}
        defaultPath={health.path || "/"}
        defaultExpectedStatuses={health.expectedStatuses || "200-399"}
      />
    </section>
  );
}
