import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link as RouterLink } from "@tanstack/react-router";

import { EntryTile } from "@/components/home/EntryTile";
import { shortName } from "@/components/home/jam-banner";
import { RECENT_ENTRIES_PER_JAM, type RecentEntry } from "@/components/home/use-recent-entries";
import { useJamColor } from "@/components/jams/JamCalendarPage/board/use-jam-color";
import {
  type JamFromList,
  jamShelf,
  jamSignal,
  nextMilestone,
  type ShelfKind,
} from "@/components/jams/JamCalendarPage/helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { DotGrid } from "@/components/ui/dot-grid";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { itchImageUrl } from "@/lib/itch-image";
import { durationDays, formatCountdown } from "@/lib/jam-countdown";
import { hostName, jamLinkParams, jamMonthDay } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

/** Shelf → chip. Voting reads as a distinct phase from live, and the
 * perpetual "ongoing" bucket deliberately gets the quietest treatment. */
const SHELF_BADGE: Record<
  ShelfKind | "archive",
  { label: string; variant: "destructive" | "secondary" | "warning" | "outline" }
> = {
  live: { label: "LIVE", variant: "destructive" },
  upcoming: { label: "UPCOMING", variant: "secondary" },
  voting: { label: "VOTING", variant: "warning" },
  ongoing: { label: "ONGOING", variant: "outline" },
  archive: { label: "CLOSED", variant: "outline" },
};

interface JamShowcaseRowProps {
  jam: JamFromList;
  entries: RecentEntry[];
  now: Date;
}

/**
 * One jam as a single card: art, the facts, and — only when there are any
 * — a strip of what people submitted.
 *
 * The first cut of this gave entries their own half of the row, with a
 * "no submissions yet" panel filling it otherwise. That panel was the
 * common case, not the fallback: every upcoming jam has zero entries by
 * definition, so half the band was a countdown floating in an empty box.
 * Folding the facts back into the card and letting the entries strip
 * appear only when it has something to show costs the row nothing when
 * entries are missing and reads denser when they aren't.
 */
export function JamShowcaseRow({ jam, entries, now }: JamShowcaseRowProps) {
  // Same hook the board's rows and cards use: the host's own itch theme
  // color, palette pick only as a fallback. Deriving it locally is how the
  // home band ended up giving a jam a different colorway than /jams did.
  const jamColor = useJamColor(jam);
  const badge = SHELF_BADGE[jamShelf(jam, now)];
  const milestone = nextMilestone(jam, now);
  const counted = milestone ? formatCountdown(milestone.date, now) : null;
  const signal = jamSignal(jam, now);
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);
  const duration = durationDays(jam.startsAt, jam.endsAt);

  const hasEntries = entries.length > 0;

  return (
    <Well className="overflow-hidden">
      {/* The board washes each row in its jam's color at 9%; the band does
          the same so a jam reads as the same jam on both pages. Flat, not a
          blurred copy of the banner — see `ShelfRow`. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `color-mix(in srgb, ${jamColor} 9%, transparent)` }}
      />
      <div className="relative flex flex-col sm:flex-row">
        {/* itch banners vary wildly in aspect, and most of them carry the
            jam's name as art — cropping to the box swallowed it. The whole
            banner is letterboxed `object-contain` against the jam's own itch
            theme color, the same way the board's cards do it; the fill
            doubles as the art for jams with no banner at all. */}
        <div
          className="relative aspect-[16/7] w-full shrink-0 overflow-hidden sm:aspect-auto sm:h-auto sm:w-56 lg:w-72"
          style={{ background: jamColor }}
        >
          {jam.bannerUrl ? (
            <img
              src={itchImageUrl(jam.bannerUrl, { width: 640 })}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <>
              <DotGrid className="absolute inset-0" />
              <Text
                bold
                density="dense"
                className="absolute inset-0 flex items-center justify-center text-3xl tracking-tighter text-foreground/40"
              >
                {shortName(jam.title)}
              </Text>
            </>
          )}
          <div className="absolute top-2 left-2">
            <Badge variant={badge.variant} size="label">
              {badge.label}
            </Badge>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="min-w-0">
            <RouterLink
              to="/jams/$jamSlug"
              params={jamLinkParams(jam)}
              className="text-inherit hover:text-primary"
            >
              <Heading as="h3" size="lg" ellipsis className="leading-tight">
                {jam.title}
              </Heading>
            </RouterLink>
            <MicroLabel as="div" ellipsis className="mt-0.5">
              {start.month} {start.day}
              {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
              {duration ? ` · ${duration}` : ""} · {hostName(jam)}
            </MicroLabel>
          </div>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-1">
            {/* One participation number, not two: `jamSignal` is the house
                rule for which of joined/entries is meaningful at a jam's
                current phase. Showing both put "ENTRIES 0" on every
                upcoming jam, which is true and says nothing. */}
            <div className="flex gap-5">
              <Stat label={milestone?.label ?? "CLOSED"} value={counted?.text ?? "—"} accent />
              <Stat label={signal.label} value={signal.value.toLocaleString()} />
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <RouterLink
                  to="/jams/$jamSlug"
                  params={jamLinkParams(jam)}
                  aria-label={`Open ${jam.title}`}
                />
              }
              className="gap-1.5 text-[11px] font-bold tracking-widest text-muted-foreground hover:text-primary"
            >
              OPEN
              <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
            </Button>
          </div>
        </div>
      </div>

      {/* The strip is additive: a jam with nothing submitted simply ends
          at the card above, rather than reserving space to say so. */}
      {hasEntries && <EntryStrip entries={entries} />}
    </Well>
  );
}

/**
 * The half-width card for jams with nothing submitted yet — the same facts
 * as a row, minus the entries strip they don't have. The whole card is the
 * link (a Chonk rather than a Well), so it carries no OPEN button, and the
 * art column is narrower than the row's: two of these sit side by side.
 */
export function JamShowcaseCard({ jam, now }: { jam: JamFromList; now: Date }) {
  const jamColor = useJamColor(jam);
  const badge = SHELF_BADGE[jamShelf(jam, now)];
  const milestone = nextMilestone(jam, now);
  const counted = milestone ? formatCountdown(milestone.date, now) : null;
  const signal = jamSignal(jam, now);
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);
  const duration = durationDays(jam.startsAt, jam.endsAt);

  return (
    <Chonk
      variant="surface"
      size="sm"
      className="group/card overflow-hidden"
      render={
        <RouterLink
          to="/jams/$jamSlug"
          params={jamLinkParams(jam)}
          aria-label={`Open ${jam.title}`}
        />
      }
    >
      {/* Same 9% wash as the rows, so a jam reads as the same jam in
          either bucket. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `color-mix(in srgb, ${jamColor} 9%, transparent)` }}
      />
      <div
        className="relative w-28 shrink-0 self-stretch overflow-hidden sm:w-40 lg:w-52"
        style={{ background: jamColor }}
      >
        {jam.bannerUrl ? (
          <img
            src={itchImageUrl(jam.bannerUrl, { width: 480 })}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <>
            <DotGrid className="absolute inset-0" />
            <Text
              bold
              density="dense"
              className="absolute inset-0 flex items-center justify-center text-xl tracking-tighter text-foreground/40"
            >
              {shortName(jam.title)}
            </Text>
          </>
        )}
        <div className="absolute top-2 left-2">
          <Badge variant={badge.variant} size="label">
            {badge.label}
          </Badge>
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col gap-2 p-2.5 pr-3">
        <div className="min-w-0">
          <Heading
            as="h3"
            size="md"
            ellipsis
            className="leading-tight transition-colors group-hover/card:text-primary"
          >
            {jam.title}
          </Heading>
          <MicroLabel as="div" ellipsis className="mt-0.5">
            {start.month} {start.day}
            {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
            {duration ? ` · ${duration}` : ""} · {hostName(jam)}
          </MicroLabel>
        </div>

        <div className="mt-auto flex gap-5 pt-1">
          <Stat label={milestone?.label ?? "CLOSED"} value={counted?.text ?? "—"} accent />
          <Stat label={signal.label} value={signal.value.toLocaleString()} />
        </div>
      </div>
    </Chonk>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <MicroLabel as="div">{label}</MicroLabel>
      <Text
        as="div"
        bold
        density="dense"
        className={cn("text-lg whitespace-nowrap tabular-nums", accent && "text-primary")}
      >
        {value}
      </Text>
    </div>
  );
}

/** Bleeds to the card edges, hides its scrollbar and snaps — the same
 * treatment `ShortcutTiles` gives the touch dock. Works on both pointer
 * and touch, so the two home pages don't need separate layouts.
 *
 * `scroll-px-3` matches the padding: a snap point is measured from the
 * scroll-padding edge, so without it a strip long enough to scroll snapped
 * its first cover flush against the card border while a short strip — with
 * no snap position to settle into — kept its inset. */
const STRIP_SCROLLER =
  "flex snap-x scroll-px-3 gap-2 overflow-x-auto px-3 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function EntryStrip({ entries }: { entries: RecentEntry[] }) {
  return (
    <div className="relative border-t border-muted/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <MicroLabel>RECENT ENTRIES</MicroLabel>
      </div>
      <div className={STRIP_SCROLLER}>
        {entries.slice(0, RECENT_ENTRIES_PER_JAM).map((entry) => (
          <EntryTile key={entry.entryId} entry={entry} className="w-32 shrink-0 snap-start" />
        ))}
      </div>
    </div>
  );
}
