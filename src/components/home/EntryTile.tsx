import type { RecentEntry } from "@/components/home/use-recent-entries";
import { safeThemeColor } from "@/components/jams/JamCalendarPage/helpers";
import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { MicroLabel, Text } from "@/components/ui/typography";
import { itchImageUrl } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

/** The slice of an entry the tile renders — structural, since the band
 * feeds it `listRecentEntries` rows and the hero grid `listJamEntries`. */
export type EntryTileEntry = Pick<
  RecentEntry,
  "entryId" | "gameTitle" | "gameUrl" | "gameCoverUrl" | "gameCoverColor" | "authorName" | "rank"
>;

/** One submitted game: cover, title, author. Shared by the band's strip and
 * the hero grid — callers size it via `className`. */
export function EntryTile({ entry, className }: { entry: EntryTileEntry; className?: string }) {
  // Scraped text; never reaches a style attribute without re-validation.
  const cover = safeThemeColor(entry.gameCoverColor) ?? "var(--muted)";

  return (
    <a
      href={entry.gameUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("group/entry flex min-w-0 flex-col gap-1.5", className)}
    >
      <div
        className="relative aspect-[63/50] w-full overflow-hidden rounded-md border border-muted/40 transition-colors group-hover/entry:border-primary"
        style={{ background: cover }}
      >
        {entry.gameCoverUrl ? (
          <img
            src={itchImageUrl(entry.gameCoverUrl, { width: 384 })}
            alt=""
            aria-hidden
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
    </a>
  );
}
