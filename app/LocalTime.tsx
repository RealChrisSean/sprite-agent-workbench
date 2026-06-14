"use client";

import { useSyncExternalStore } from "react";

const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function formatIn(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    ...FORMAT_OPTIONS,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

// The store never changes, so subscribe is a no-op. getSnapshot returns true
// on the client and false on the server, which lets us render a deterministic
// UTC string during SSR + hydration, then the viewer's local time afterward —
// without a hydration mismatch or setState-in-effect.
const noopSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Renders a timestamp in the VIEWER's local timezone.
 *
 * The dashboard is server-rendered (force-dynamic) and the hosted Sprite's
 * clock is UTC, so formatting on the server shows UTC to everyone. This
 * formats in the browser's timezone instead.
 */
export function LocalTime({ iso }: { iso: string | null }) {
  const isClient = useSyncExternalStore(noopSubscribe, onClient, onServer);

  const text = !iso
    ? "Never"
    : isClient
      ? formatIn(iso)
      : formatIn(iso, "UTC");

  return (
    <time dateTime={iso ?? undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
