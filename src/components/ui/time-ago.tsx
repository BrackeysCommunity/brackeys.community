import { timeAgo } from "@/lib/format-time";
import useDateNow from "@/lib/hooks/use-date-now";

/**
 * `timeAgo` for JSX. Reads the shared clock, so the text matches the
 * server's render during hydration and rolls over with the minute after
 * it. Use this inside components; the bare function is for strings built
 * outside React (emails, tooltips), where the caller passes its own `now`.
 */
export function TimeAgo({ date }: { date: string | Date | null }) {
  const now = useDateNow();
  return <>{timeAgo(date, now)}</>;
}
