import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { JamFromList } from "../helpers";
import { SUPPORTING_TEXT } from "./milestones";

/**
 * Hashtag + lead host for a card or row. Co-hosts collapse to a `+N`
 * count rather than a name list — big collaborative jams carry five or
 * six of them and would eat the whole line, and the full roster is one
 * click away in the detail modal.
 *
 * Featured cards opt out of the hashtag (`showHashtag={false}`): they
 * give the host its own line and the tag would crowd the name off it.
 */
export function HostLine({ jam, showHashtag = true }: { jam: JamFromList; showHashtag?: boolean }) {
  const cohostCount = Math.max(0, jam.hosts.length - 1);
  const hashtag = showHashtag ? jam.hashtag : null;
  const host = jam.hosts[0];
  if (!hashtag && !host) return null;
  return (
    <Text
      variant="muted"
      className={cn("truncate tracking-widest whitespace-nowrap", SUPPORTING_TEXT)}
    >
      {hashtag && (
        <span className="font-semibold text-foreground uppercase">{hashtag.toUpperCase()}</span>
      )}
      {hashtag && host && <span> · </span>}
      {host && <span className="font-semibold text-foreground">{host.name}</span>}
      {cohostCount > 0 && <span> +{cohostCount}</span>}
    </Text>
  );
}
