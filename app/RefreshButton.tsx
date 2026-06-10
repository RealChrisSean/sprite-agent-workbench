"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="mt-4 inline-flex rounded-full bg-lime-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-70"
      disabled={isPending}
      type="button"
      onClick={() => startTransition(() => router.refresh())}
    >
      {isPending ? "Refreshing..." : "Refresh now"}
    </button>
  );
}
