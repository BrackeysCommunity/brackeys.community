import { useEffect, useState } from "react";

const MINUTE = 60_000;

/** `date` relative to `now`: "just now", "12m ago", "3h ago", "2d ago"; empty for no date. */
export function timeAgo(date: string | number | Date | null | undefined, now: number): string {
  if (date == null) return "";
  const seconds = Math.floor((now - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The wall clock, re-read on each wall-clock minute so every caller rolls over together. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        MINUTE - (Date.now() % MINUTE),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** `timeAgo` for JSX, on the shared minute clock; pass `now` to pin it. */
export function TimeAgo({
  date,
  now,
}: {
  date: string | number | Date | null | undefined;
  now?: number;
}) {
  const clock = useMinuteClock();
  const at = date == null ? null : new Date(date);
  return (
    <time dateTime={at && !Number.isNaN(at.getTime()) ? at.toISOString() : undefined}>
      {timeAgo(date, now ?? clock)}
    </time>
  );
}
