import { Link as RouterLink } from "@tanstack/react-router";

import type { RecentEntry } from "@/components/home/use-recent-entries";
import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { MicroLabel, Text } from "@/components/ui/typography";
import { safeThemeColor } from "@/lib/jam-palette";
import { cn } from "@/lib/utils";

/** The slice of an entry the tile renders — structural, since the band
 * feeds it `listRecentEntries` rows and the hero grid `listJamEntries`. */
export type EntryTileEntry = Pick<
  RecentEntry,
  "entryId" | "gameId" | "gameTitle" | "gameCoverUrl" | "gameCoverColor" | "authorName" | "rank"
>;

/** One submitted game: cover, title, author. Shared by the band's strip and
 * the hero grid — callers size it via `className`.
 *
 * Links inward through the mint-on-visit route (which lands on the game's
 * canonical project page, creating it on first visit) rather than out to
 * itch — `rel="nofollow"` for the same reason `JamEntryCard` carries it.
 * `?jam=` tells the landing page which jam the visitor came from. */
export function EntryTile({
  entry,
  jamId,
  className,
}: {
  entry: EntryTileEntry;
  jamId: number;
  className?: string;
}) {
  // Scraped text; never reaches a style attribute without re-validation.
  const cover = safeThemeColor(entry.gameCoverColor) ?? "var(--muted)";

  return (
    <RouterLink
      to="/projects/game/$gameId"
      params={{ gameId: String(entry.gameId) }}
      search={{ jam: jamId }}
      rel="nofollow"
      data-hover-play-group
      className={cn("group/entry flex min-w-0 flex-col gap-1.5", className)}
    >
      <div
        className="relative aspect-[63/50] w-full overflow-hidden rounded-md border border-muted/40 transition-colors group-hover/entry:border-primary"
        style={{ background: cover }}
      >
        {entry.gameCoverUrl ? (
          <HoverPlayImage
            src={entry.gameCoverUrl}
            transform={{ width: 384 }}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <DotGrid />
        )}
        {entry.rank != null && (
          <div className="absolute top-1 left-1">
            <Badge variant="default" size="label">
              #{entry.rank}
            </Badge>
          </div>
        )}
      </div>
      <Text
        as="div"
        size="sm"
        bold
        ellipsis
        density="compressed"
        className="group-hover/entry:text-primary"
      >
        {entry.gameTitle}
      </Text>
      <MicroLabel as="div" ellipsis>
        {entry.authorName ?? "UNKNOWN"}
      </MicroLabel>
    </RouterLink>
  );
}
