"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export interface SpriteCheckpointOption {
  name: string;
  status: string;
}

export function SpriteCheckpointSelect({
  options,
  selectedName,
}: {
  options: SpriteCheckpointOption[];
  selectedName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex w-full flex-col gap-2 sm:max-w-sm">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        Inspect checkpoints for
      </span>
      <select
        aria-label="Choose Sprite checkpoints to inspect"
        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 shadow-sm outline-none transition hover:border-slate-500 focus:border-lime-500 focus:ring-4 focus:ring-lime-200 disabled:cursor-wait disabled:opacity-70"
        defaultValue={selectedName}
        disabled={isPending}
        onChange={(event) => {
          const value = event.currentTarget.value;
          startTransition(() => {
            router.replace(`/?sprite=${encodeURIComponent(value)}`, {
              scroll: false,
            });
          });
        }}
      >
        {options.map((option) => (
          <option key={option.name} value={option.name}>
            {option.name} - {option.status}
          </option>
        ))}
      </select>
    </label>
  );
}
