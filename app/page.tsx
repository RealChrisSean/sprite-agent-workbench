import {
  formatDate,
  getDashboardData,
  getSpriteDashboardUrl,
  getSpriteStatusGroups,
  selectDashboardSprite,
  type DashboardSprite,
  type SleepInference,
  type SpriteCheckpoint,
  type SpriteStatusGroup,
} from "@/lib/sprites";
import {
  getAuthSourceLabel,
  type SpriteAuthStatus,
} from "@/lib/sprite-auth";
import Link from "next/link";
import { CheckpointCreateForm } from "./CheckpointCreateForm";
import { SpriteCheckpointSelect } from "./SpriteCheckpointSelect";
import { TokenFallbackForm } from "./TokenFallbackForm";

export const dynamic = "force-dynamic";

type HomeSearchParams = {
  sprite?: string | string[] | undefined;
};

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const requestedSpriteName = readSingleParam(params.sprite);
  const data = await getDashboardData(requestedSpriteName);
  const selectedSprite = data.ok
    ? selectDashboardSprite(data.sprites, requestedSpriteName)
    : null;
  const statusGroups = data.ok ? getSpriteStatusGroups(data.sprites) : [];

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
              A dashboard for anyone using Sprites. It prefers a Sprites
              Connector, can use a server-only token when needed, falls back to
              your local Sprite CLI, tracks checkpoint history, and explains
              cold state with evidence instead of vibes.
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
          <>
            <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-950">
              <h2 className="text-2xl font-black">Sprite data is not ready</h2>
              <p className="mt-2 text-red-800">{data.error?.message}</p>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-red-950 p-4 text-sm text-red-50">
                {data.error?.hint}
              </pre>
            </section>
            <AuthSetupPanel auth={data.auth} />
          </>
        ) : (
          <>
            {data.source === "saved-token" ? (
              <AuthSetupPanel auth={data.auth} compact />
            ) : null}

            <section className="grid gap-4 md:grid-cols-4">
              <MetricCard
                label="Org"
                value={data.orgName || "Unknown"}
                detail={`Current Sprite account via ${getAuthSourceLabel(data.source)}`}
              />
              <MetricCard label="Sprites" value={String(data.counts.total)} detail="Visible to this account" />
              <MetricCard
                label="Running / Warm"
                value={`${data.counts.running} / ${data.counts.warm}`}
                detail={`Limits: ${data.counts.runningLimit ?? "-"} running, ${data.counts.warmLimit ?? "-"} warm`}
              />
              <MetricCard label="Cold" value={String(data.counts.cold)} detail="Likely asleep or idle" />
            </section>

            <FleetStatusPanel
              groups={statusGroups}
              total={data.counts.total}
              runningLimit={data.counts.runningLimit}
              warmLimit={data.counts.warmLimit}
            />

            {selectedSprite ? (
              <CheckpointInspector
                selectedSprite={selectedSprite}
                sprites={data.sprites}
              />
            ) : null}

            <section className="grid gap-5 lg:grid-cols-2">
              {data.sprites.map((sprite) => (
                <SpriteCard
                  key={sprite.id}
                  sprite={sprite}
                  checkpointsLoaded={sprite.name === selectedSprite?.name}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function AuthSetupPanel({
  auth,
  compact = false,
}: {
  auth: SpriteAuthStatus;
  compact?: boolean;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
            Secure setup
          </p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            Do not make the token part of the app.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The best setup is a Sprites Connector. It keeps the raw token in the
            Sprites organization vault and lets this Sprite call the gateway
            without holding the credential itself.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700">
          Active: {getAuthSourceLabel(auth.source)}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
            Recommended
          </p>
          <h3 className="mt-2 text-2xl font-black">
            Use a Sprites Custom API Connector.
          </h3>
          <p className="mt-3 text-sm leading-6 text-emerald-900">
            Create a Custom API connector for `https://api.sprites.dev`, store
            the Sprites API token there, grant only this Sprite access, then set
            the gateway base URL as a server-only env var.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-emerald-950 p-4 text-xs text-emerald-50">
            SPRITES_API_GATEWAY_BASE_URL=https://api.sprites.dev/v1/gateway/custom_api/CONNECTION_ID
          </pre>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-slate-950">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
            Also OK
          </p>
          <h3 className="mt-2 text-2xl font-black">
            Use a server-only environment token.
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            This is simpler, but the Sprite process holds a long-lived token.
            Use it only as a server env var. Never use `NEXT_PUBLIC_`, never
            put it in frontend code, and avoid checkpointing secret files.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-50">
            SPRITES_API_TOKEN=your-server-only-token
          </pre>
        </div>
      </div>

      {!compact || auth.savedTokenConfigured ? (
        <div className="mt-4">
          <TokenFallbackForm hasSavedToken={auth.savedTokenConfigured} />
        </div>
      ) : null}
    </section>
  );
}

function readSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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

function FleetStatusPanel({
  groups,
  total,
  runningLimit,
  warmLimit,
}: {
  groups: SpriteStatusGroup<DashboardSprite>[];
  total: number;
  runningLimit: number | null;
  warmLimit: number | null;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/75 p-5 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
            Fleet state
          </p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            Which Sprites are awake?
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Built for bigger fleets: grouped status lanes, compact chips, and
            hover tooltips with the evidence behind each running, warm, or cold
            call.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <span className="font-black text-slate-950">{total}</span> Sprites
          visible · limits {runningLimit ?? "-"} running / {warmLimit ?? "-"}{" "}
          warm
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.key}
            className={`rounded-3xl border p-4 ${getStatusGroupClasses(group.key)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">
                  {group.label}
                </p>
                <p className="mt-1 text-sm font-semibold opacity-80">
                  {group.detail}
                </p>
              </div>
              <span className="rounded-full bg-white/70 px-3 py-1 text-lg font-black shadow-sm">
                {group.sprites.length}
              </span>
            </div>

            <div className="mt-4 max-h-48 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
                {group.sprites.map((sprite) => (
                  <span
                    key={sprite.id}
                    title={getSpriteTooltip(sprite)}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-xs font-bold shadow-sm"
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClasses(sprite.status)}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{sprite.name}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CheckpointInspector({
  selectedSprite,
  sprites,
}: {
  selectedSprite: DashboardSprite;
  sprites: DashboardSprite[];
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 text-slate-100 shadow-[0_24px_90px_rgba(15,23,42,0.20)]">
      <div className="border-b border-slate-800 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-lime-300">
              Checkpoints
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              {selectedSprite.name}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Restore points for one Sprite at a time. This keeps the timeline
              readable when the account has dozens of Sprites.
            </p>
          </div>
          <SpriteCheckpointSelect
            selectedName={selectedSprite.name}
            options={sprites.map((sprite) => ({
              name: sprite.name,
              status: sprite.status,
            }))}
          />
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <StatusPill status={selectedSprite.status} />
          <span>{selectedSprite.checkpoints.length} checkpoints</span>
          <span>Last running {formatDate(selectedSprite.last_running_at)}</span>
        </div>

        <div className="mb-4">
          <CheckpointCreateForm spriteName={selectedSprite.name} />
        </div>

        {selectedSprite.checkpointError ? (
          <p className="rounded-2xl bg-red-950/70 p-4 text-sm text-red-100">
            {selectedSprite.checkpointError}
          </p>
        ) : selectedSprite.checkpoints.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
            No checkpoints found for this Sprite yet.
          </p>
        ) : (
          <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {selectedSprite.checkpoints.map((checkpoint) => (
              <CheckpointListItem
                key={`${selectedSprite.name}-${checkpoint.id}`}
                checkpoint={checkpoint}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function CheckpointListItem({
  checkpoint,
}: {
  checkpoint: SpriteCheckpoint;
}) {
  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm font-black text-lime-200">
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
  );
}

function SpriteCard({
  sprite,
  checkpointsLoaded,
}: {
  sprite: DashboardSprite;
  checkpointsLoaded: boolean;
}) {
  const latestCheckpoint = sprite.checkpoints[0] ?? null;

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
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              href={getSpriteDashboardUrl(sprite)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${sprite.name} in the Sprites dashboard`}
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
          </div>
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

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            Operations snapshot
          </p>
          {checkpointsLoaded ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Info label="Checkpoints" value={String(sprite.checkpoints.length)} />
              <Info label="Latest" value={latestCheckpoint?.id || "None"} />
              <Info
                label="Created"
                value={latestCheckpoint ? formatDate(latestCheckpoint.create_time) : "Never"}
              />
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
              Checkpoints load in the inspector above only for the selected
              Sprite, so a large fleet does not fire a checkpoint request for
              every environment.
            </div>
          )}
          {checkpointsLoaded && sprite.checkpointError ? (
            <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm leading-6 text-red-900">
              {sprite.checkpointError}
            </p>
          ) : checkpointsLoaded && latestCheckpoint ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
              Latest checkpoint:{" "}
              <span className="font-semibold text-slate-950">
                {latestCheckpoint.comment || "No comment"}
              </span>
            </p>
          ) : checkpointsLoaded ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
              No checkpoints yet. Use the inspector above when this Sprite has
              a timeline to review.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function getSpriteTooltip(sprite: DashboardSprite): string {
  return [
    `${sprite.name}: ${sprite.status}`,
    sprite.sleep.label,
    ...sprite.sleep.evidence,
  ].join("\n");
}

function getStatusGroupClasses(group: SpriteStatusGroup<DashboardSprite>["key"]) {
  if (group === "running") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (group === "warm") {
    return "border-lime-200 bg-lime-50 text-lime-950";
  }
  if (group === "cold") {
    return "border-slate-200 bg-slate-50 text-slate-950";
  }
  return "border-amber-200 bg-amber-50 text-amber-950";
}

function getStatusDotClasses(status: string) {
  if (status === "running") return "bg-emerald-500";
  if (status === "warm") return "bg-lime-500";
  if (status === "cold") return "bg-slate-400";
  return "bg-amber-500";
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
