import { ChampionIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

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
              <li key={entry.jamId}>
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
      className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
    >
      <Text
        as="div"
        monospace
        bold
        density="dense"
        className="text-5xl leading-none tracking-tight text-warning tabular-nums"
      >
        #{best.rank}
      </Text>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          BEST FINISH
        </Text>
        <Text bold size="lg" className="truncate">
          {best.title}
        </Text>
        <Text monospace size="xs" variant="muted" className="tracking-widest">
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
        <Text monospace bold density="dense" className="text-2xl leading-none tabular-nums">
          {day.toString().padStart(2, "0")}
        </Text>
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {month} '{year}
        </Text>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Text bold size="md" className="truncate">
            {entry.title}
          </Text>
          {entry.pill ? (
            <Badge variant="warning" className="font-mono text-[10px] tracking-widest uppercase">
              ⚐ {entry.pill}
            </Badge>
          ) : null}
        </div>
        {entry.shortNote ? (
          <Text size="sm" variant="muted" className="truncate">
            {entry.shortNote}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col items-end leading-tight">
        <Text monospace bold className="text-2xl tabular-nums">
          {entry.rank != null ? `#${entry.rank}` : "—"}
        </Text>
        {entry.totalEntries ? (
          <Text monospace size="xs" variant="muted" className="tracking-widest tabular-nums">
            /{entry.totalEntries}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
