// How a save is named and dated wherever the site lists one: the play
// page's "Keep your saves" and Settings → Game saves.

import type { SaveMeta } from "@jams/engine";

import { TimeAgo } from "@/components/ui/time-ago";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";

/** A save's own title, or its slot when it has none. */
export const saveTitle = (meta: Pick<SaveMeta, "title">, slot: string): string =>
  meta.title?.trim() || `Slot ${slot}`;

/** The day and minute, in UTC. */
export const utcDateTime = (date: Date | string | number): string =>
  `${formatDate(new Date(date), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} UTC`;

/** The day alone, in UTC. */
export const utcDay = (date: Date | string | number): string => `${formatDate(new Date(date))} UTC`;

/**
 * "<label> 3d ago", the full UTC time on hover. With `showDay` the UTC day
 * is written out too, for screens that can't hover.
 */
export function SaveTime({
  label,
  date,
  showDay = false,
}: {
  label: string;
  date: Date | string | number;
  showDay?: boolean;
}) {
  const at = new Date(date);
  return (
    <SimpleTooltip content={utcDateTime(at)}>
      <time dateTime={at.toISOString()}>
        {label} <TimeAgo date={at} />
        {showDay ? <> · {utcDay(at)}</> : null}
      </time>
    </SimpleTooltip>
  );
}
