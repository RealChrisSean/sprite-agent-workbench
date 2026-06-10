export function StatusPill({ status }: { status: string }) {
  const classes =
    status === "running"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : status === "warm"
        ? "bg-lime-100 text-lime-900 border-lime-200"
        : status === "cold"
          ? "bg-slate-100 text-slate-700 border-slate-200"
          : "bg-amber-100 text-amber-900 border-amber-200";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${classes}`}
    >
      {status}
    </span>
  );
}
