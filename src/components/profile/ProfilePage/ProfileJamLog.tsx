import { ChampionIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { Link as TextLink, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { jamLinkParams } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

import type { JamLogBest, JamLogEntry } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { ProfileSectionHeader, ViewAllAction } from "./ProfileSectionHeader";

interface ProfileJamLogSectionProps {
  index: string;
  best: JamLogBest | null;
  entries: JamLogEntry[];
  onViewAll?: () => void;
}

/**
 * `§NN JAM LOG`. Optional "best finish" callout at the top, followed
 * by a table-style list of jam entries (date, title, blurb, rank /
 * total).
 */
export function ProfileJamLogSection({
  index,
  best,
  entries,
  onViewAll,
}: ProfileJamLogSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="JAM LOG"
        action={onViewAll && entries.length > 0 ? <ViewAllAction onClick={onViewAll} /> : null}
      />
      {best ? <BestFinishCallout best={best} /> : null}
      {entries.length === 0 ? (
        <ProfileEmptyState
          glyph="◎"
          title="No jam entries yet"
          hint="Submit your first jam and your finishes will land here automatically."
        />
      ) : (
        <Well className="overflow-hidden p-0">
          <ul className="flex flex-col divide-y divide-muted/30">
            {entries.map((entry) => (
              <li key={entry.id}>
                <JamLogRow entry={entry} />
              </li>
            ))}
          </ul>
        </Well>
      )}
    </section>
  );
}

function BestFinishCallout({ best }: { best: JamLogBest }) {
  return (
    <Chonk
      variant="surface"
      size="lg"
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
    >
      {/* Auto-width column + a step down past two digits: a fixed 5rem
          column let a large rank run under the title. */}
      <Text
        as="div"
        bold
        density="dense"
        className={cn(
          "leading-none tracking-tight text-warning tabular-nums",
          best.rank >= 100 ? "text-4xl" : "text-5xl",
        )}
      >
        #{best.rank}
      </Text>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text size="xs" variant="muted" className="tracking-widest">
          BEST FINISH
        </Text>
        <Text bold size="lg" className="truncate">
          {best.title}
        </Text>
        <Text size="xs" variant="muted" className="tracking-widest">
          {best.subtitle}
        </Text>
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded bg-warning/15 text-warning">
        <HugeiconsIcon icon={ChampionIcon} size={24} />
      </div>
    </Chonk>
  );
}

function JamLogRow({ entry }: { entry: JamLogEntry }) {
  const day = entry.startedAt.getUTCDate();
  const month = entry.startedAt
    .toLocaleString(undefined, { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const year = entry.startedAt.getUTCFullYear().toString().slice(-2);

  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
      <div className="flex flex-col items-start text-left">
        <Text bold density="dense" className="text-2xl leading-none tabular-nums">
          {day.toString().padStart(2, "0")}
        </Text>
        <Text size="xs" variant="muted" className="tracking-widest">
          {month} '{year}
        </Text>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {entry.url ? (
            <TextLink
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              size="md"
              bold
              className="truncate hover:text-primary hover:underline"
            >
              {entry.title}
            </TextLink>
          ) : (
            <Text bold size="md" className="truncate">
              {entry.title}
            </Text>
          )}
          {entry.pill ? (
            <Badge variant="warning" size="label" className="uppercase">
              ⚐ {entry.pill}
            </Badge>
          ) : null}
        </div>
        {entry.jamName || entry.shortNote ? (
          <Text as="div" size="sm" variant="muted" className="truncate">
            {/* The jam name goes to the jam's page here — a log row used to
                offer nothing but exits to itch.io. Free-text jams (no
                scraped row) stay plain: there's no page to point at. */}
            {entry.jamName ? (
              entry.jamSlug || entry.jamId != null ? (
                <RouterLink
                  to="/jams/$jamSlug"
                  params={jamLinkParams({ jamId: entry.jamId ?? 0, slug: entry.jamSlug })}
                  className="hover:text-primary hover:underline"
                >
                  {entry.jamName}
                </RouterLink>
              ) : (
                entry.jamName
              )
            ) : null}
            {entry.jamName && entry.shortNote ? " · " : null}
            {entry.shortNote}
          </Text>
        ) : null}
      </div>
      {/* The scraped Overall placement, "#rank / total entries". The em
          dash means "tracked jam, no rank yet" (voting open, or results
          never scraped); a free-text jam can never earn one, so it shows
          nothing rather than a dash that reads as a bug. Typed results on
          those rows surface as the ⚐ pill beside the title instead. */}
      {entry.rank != null || entry.jamId != null ? (
        <div className="flex flex-col items-end leading-tight">
          <Text bold className="text-2xl tabular-nums">
            {entry.rank != null ? `#${entry.rank}` : "—"}
          </Text>
          {entry.totalEntries ? (
            <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
              /{entry.totalEntries}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
