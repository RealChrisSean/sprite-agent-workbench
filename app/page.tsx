import type {
  CostExposureSummary,
  CostRiskFlag,
  SpriteExposureSummary,
} from "@/lib/cost-ledger";
import {
  getDashboardData,
  getSpriteDashboardUrl,
  getSpriteStatusGroups,
  type DashboardSprite,
  type SpriteStatusGroup,
} from "@/lib/sprites";
import {
  getAuthSourceLabel,
  type SpriteAuthStatus,
  type SpriteAuthSource,
} from "@/lib/sprite-auth";
import {
  ADMIN_SESSION_COOKIE,
  getAdminToken,
  verifyAdminSessionValue,
} from "@/lib/admin-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AdminAccessForm } from "./AdminAccessForm";
import { CollectNowButton } from "./CollectNowButton";
import { LocalTime } from "./LocalTime";
import { RefreshButton } from "./RefreshButton";
import { StatusPill } from "./StatusPill";
import { TestConnectionButton } from "./TestConnectionButton";
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
  if (requestedSpriteName) {
    redirect(`/sprite/${encodeURIComponent(requestedSpriteName)}`);
  }

  const data = await getDashboardData(null, { loadCheckpoints: false });
  const statusGroups = data.ok ? getSpriteStatusGroups(data.sprites) : [];
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
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] border border-white/70 bg-white/70 px-6 py-4 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur">
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-950">
              Sprite Agent Workbench
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Fleet state with evidence · checkpoints with context · sampled
              cost exposure
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminAccessForm {...adminAccess} />
            <span className="font-mono text-sm text-slate-600">
              Refreshed <LocalTime iso={data.fetchedAt} />
            </span>
            <RefreshButton />
          </div>
        </header>

        {!data.ok ? (
          <>
            <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-950">
              <h2 className="text-xl font-bold">Sprite data is not ready</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-red-900">
                This dashboard shows why your Sprites are awake, cold, or ready
                to restore — fleet state with evidence, checkpoint history with
                context, and passive cost exposure. It needs a connection
                first.
              </p>
              <p className="mt-2 text-red-800">{data.error?.message}</p>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-red-950 p-4 text-sm text-red-50">
                {data.error?.hint}
              </pre>
            </section>
            <AuthSetupPanel auth={data.auth} canWrite={adminAccess.unlocked} />
          </>
        ) : (
          <>
            {data.source === "saved-token" ? (
              <AuthSetupPanel
                auth={data.auth}
                canWrite={adminAccess.unlocked}
                compact
              />
            ) : null}

            <FleetStatusPanel
              groups={statusGroups}
              orgName={data.orgName}
              source={data.source}
              runningLimit={data.counts.runningLimit}
              warmLimit={data.counts.warmLimit}
            />

            {data.costExposure ? (
              <CostExposurePanel
                exposure={data.costExposure}
                canWrite={adminAccess.unlocked}
              />
            ) : null}

            <SpriteRoster sprites={data.sprites} />
          </>
        )}
      </div>
    </main>
  );
}

function AuthSetupPanel({
  auth,
  canWrite,
  compact = false,
}: {
  auth: SpriteAuthStatus;
  canWrite: boolean;
  compact?: boolean;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Secure setup
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            Do not make the token part of the app.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The best setup is a Sprites Connector. It keeps the raw token in the
            Sprites organization vault and lets this Sprite call the gateway
            without holding the credential itself.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            Active: {getAuthSourceLabel(auth.source)}
          </span>
          <TestConnectionButton />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
            Recommended
          </p>
          <h3 className="mt-2 text-lg font-bold">
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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Also OK
          </p>
          <h3 className="mt-2 text-lg font-bold">
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
          <TokenFallbackForm
            hasSavedToken={auth.savedTokenConfigured}
            canWrite={canWrite}
          />
        </div>
      ) : null}
    </section>
  );
}

function readSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function FleetStatusPanel({
  groups,
  orgName,
  source,
  runningLimit,
  warmLimit,
}: {
  groups: SpriteStatusGroup<DashboardSprite>[];
  orgName: string | null;
  source: SpriteAuthSource | null;
  runningLimit: number | null;
  warmLimit: number | null;
}) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/75 p-5 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Fleet state
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            Which Sprites are awake?
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Open a chip to see the evidence behind each running, warm, or cold
            call.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p>
            <span className="font-bold text-slate-950">
              {orgName || "Unknown org"}
            </span>{" "}
            · via {getAuthSourceLabel(source)}
          </p>
          <p className="mt-1">
            Limits: {runningLimit ?? "-"} running / {warmLimit ?? "-"} warm
          </p>
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
                <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">
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

            <div className="mt-4 max-h-64 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
                {group.sprites.map((sprite) => (
                  <details key={sprite.id} className="max-w-full open:w-full">
                    <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:border-slate-400 [&::-webkit-details-marker]:hidden">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClasses(sprite.status)}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{sprite.name}</span>
                    </summary>
                    <div className="mt-2 rounded-2xl border border-white/70 bg-white/80 p-3 text-xs leading-5">
                      <p className="font-bold">{sprite.sleep.label}</p>
                      <ul className="mt-1 space-y-1">
                        {sprite.sleep.evidence.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span aria-hidden="true">-</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        className="mt-2 inline-flex font-bold text-slate-950 underline-offset-2 hover:underline"
                        href={`/sprite/${encodeURIComponent(sprite.name)}`}
                      >
                        Inspect {sprite.name}
                      </Link>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SpriteRoster({ sprites }: { sprites: DashboardSprite[] }) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/75 p-5 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight text-slate-950">
          Sprites
        </h2>
        <p className="text-sm text-slate-600">
          <span className="font-bold text-slate-950">{sprites.length}</span>{" "}
          visible
        </p>
      </div>

      <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {sprites.map((sprite) => (
          <li
            key={sprite.id}
            className="flex flex-wrap items-center gap-3 p-4 transition hover:bg-slate-50"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClasses(sprite.status)}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="text-base font-semibold text-slate-950 underline-offset-2 hover:underline"
                  href={`/sprite/${encodeURIComponent(sprite.name)}`}
                >
                  {sprite.name}
                </Link>
                <StatusPill status={sprite.status} />
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                Last running <LocalTime iso={sprite.last_running_at} /> · URL
                auth{" "}
                {sprite.url_settings?.auth || "unknown"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-full bg-slate-950 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                href={`/sprite/${encodeURIComponent(sprite.name)}`}
              >
                Inspect
              </Link>
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
          </li>
        ))}
      </ul>
    </section>
  );
}

function CostExposurePanel({
  exposure,
  canWrite,
}: {
  exposure: CostExposureSummary;
  canWrite: boolean;
}) {
  const topSprites = exposure.sprites
    .filter(
      (sprite) =>
        sprite.observedActiveMs > 0 ||
        sprite.currentStatus === "running" ||
        sprite.currentStatus === "warm" ||
        sprite.riskFlags.some((flag) => flag.severity !== "info")
    )
    .slice(0, 6);
  const isQuiet = exposure.riskFlags.length === 0 && topSprites.length === 0;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-slate-950 text-slate-100 shadow-[0_24px_90px_rgba(15,23,42,0.20)]">
      <div className={isQuiet ? "p-5" : "border-b border-slate-800 p-5"}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-lime-300">
              Cost exposure
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight">
              Stop guessing what might be awake.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {exposure.disclaimer} Page refresh only reads the control plane
              and stored samples; it does not request Sprite app URLs.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-400">
            Window starts{" "}
            <span className="font-bold text-slate-100">
              <LocalTime iso={exposure.windowStartedAt} />
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DarkInfo label="Active now" value={String(exposure.activeNow)} />
          <DarkInfo
            label="Estimated Sprite-active (24h)"
            value={
              exposure.activeTimeStatus === "estimated"
                ? formatDuration(exposure.totalObservedActiveMs)
                : "Insufficient samples"
            }
          />
        </div>

        <div className="mt-4">
          <CollectNowButton canWrite={canWrite} />
        </div>

        {isQuiet ? (
          <p className="mt-4 text-sm leading-6 text-slate-400">
            No risk signals and nothing active in the latest control-plane read
            ({exposure.observationCount} observations stored). One clean
            snapshot is not a bill; schedule or run explicit collections over
            normal use.
          </p>
        ) : null}
        {exposure.writeError ? (
          <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100">
            The dashboard is showing current control-plane state, but the local
            observation ledger is unavailable.
          </p>
        ) : null}
      </div>

      {!isQuiet ? (
        <div className="grid gap-5 p-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Risk signals
            </p>
            {exposure.riskFlags.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-400">
                No obvious exposure flags from the latest control-plane read.
              </p>
            ) : (
              <RiskFlagList flags={exposure.riskFlags} />
            )}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Sprites to watch
              </p>
              <span className="text-xs text-slate-500">
                {exposure.collectionCount} collections · {exposure.observationCount}{" "}
                Sprite samples
              </span>
            </div>
            {topSprites.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Everything visible is cold or low-signal right now.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {topSprites.map((sprite) => (
                  <SpriteExposureItem
                    key={sprite.spriteName}
                    sprite={sprite}
                    activeTimeStatus={exposure.activeTimeStatus}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SpriteExposureItem({
  sprite,
  activeTimeStatus,
}: {
  sprite: SpriteExposureSummary;
  activeTimeStatus: CostExposureSummary["activeTimeStatus"];
}) {
  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-100">
              {sprite.spriteName}
            </span>
            <StatusPill status={sprite.currentStatus} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            URL auth: {sprite.currentUrlAuth} · samples:{" "}
            {sprite.observationCount}
          </p>
        </div>
        <span className="font-mono text-sm font-bold text-lime-200">
          {activeTimeStatus === "estimated"
            ? formatDuration(sprite.observedActiveMs)
            : "Insufficient"}
        </span>
      </div>

      {sprite.riskFlags.length > 0 ? (
        <RiskFlagList flags={sprite.riskFlags.slice(0, 3)} compact />
      ) : null}
    </li>
  );
}

function RiskFlagList({
  flags,
  compact = false,
}: {
  flags: CostRiskFlag[];
  compact?: boolean;
}) {
  return (
    <ul className={compact ? "mt-3 flex flex-wrap gap-2" : "mt-3 space-y-2"}>
      {flags.map((flag) => (
        <li
          key={`${flag.label}-${flag.detail}`}
          className={
            compact
              ? `rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskFlagClasses(flag.severity)}`
              : `rounded-2xl border p-3 text-sm leading-6 ${getRiskFlagClasses(flag.severity)}`
          }
          title={flag.detail}
        >
          <span className="font-bold">{flag.label}</span>
          {!compact ? <p className="opacity-75">{flag.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
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

function DarkInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
      <p className="truncate text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slate-500" title={label}>
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-black text-slate-100" title={value}>
        {value}
      </p>
    </div>
  );
}

function getRiskFlagClasses(severity: CostRiskFlag["severity"]): string {
  if (severity === "danger") {
    return "border-red-400/30 bg-red-400/10 text-red-100";
  }
  if (severity === "warning") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  }
  return "border-slate-700 bg-slate-800 text-slate-300";
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}
