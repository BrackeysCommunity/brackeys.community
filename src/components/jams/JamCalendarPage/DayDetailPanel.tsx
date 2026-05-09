import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Heading, Link, Text } from "@/components/ui/typography";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState, formatJamShortDates } from "@/lib/jam-countdown";

import { type ChipKind, type DayBuckets, jamPhase, type JamFromList, jamUrl } from "./helpers";

interface DayDetailContentProps {
  day: Date;
  buckets: DayBuckets | undefined;
}

const SECTIONS: { kind: ChipKind; label: string; glyph: string; tint: string }[] = [
  { kind: "starting", label: "STARTING", glyph: "▶", tint: "text-primary" },
  { kind: "deadline", label: "DEADLINES", glyph: "⊙", tint: "text-warning" },
  { kind: "ending", label: "ENDING", glyph: "■", tint: "text-destructive" },
];

/**
 * Inner content shown for the currently-selected day: header (date +
 * event count) plus the three event sections (STARTING / DEADLINES /
 * ENDING). Surface-agnostic — wrap in a `Well` for an inline panel or
 * place inside a `PopoverContent` for the apple-style spotlight.
 */
export function DayDetailContent({ day, buckets }: DayDetailContentProps) {
  const nowMs = useDateNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const totals = {
    starting: buckets?.starting.length ?? 0,
    deadline: buckets?.deadline.length ?? 0,
    ending: buckets?.ending.length ?? 0,
  };
  const total = totals.starting + totals.deadline + totals.ending;

  const dateLabel = day
    .toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .toUpperCase();

  return (
    <>
      <header className="flex flex-col gap-1 border-b border-muted/30 px-4 py-3">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          ◆ DAY DETAIL
        </Text>
        <Heading as="h3" size="lg" monospace className="tracking-tight">
          {dateLabel}
        </Heading>
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {total} EVENT{total === 1 ? "" : "S"}
        </Text>
      </header>

      {total === 0 ? (
        <Text
          as="div"
          monospace
          size="sm"
          variant="muted"
          align="center"
          className="p-6 tracking-widest uppercase"
        >
          Nothing scheduled
        </Text>
      ) : (
        <div className="flex flex-col">
          {SECTIONS.map((section) => {
            const list = buckets?.[section.kind] ?? [];
            if (list.length === 0) return null;
            return (
              <DaySection
                key={section.kind}
                glyph={section.glyph}
                label={section.label}
                kind={section.kind}
                tint={section.tint}
                jams={list}
                now={now}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function DaySection({
  glyph,
  label,
  kind,
  tint,
  jams,
  now,
}: {
  glyph: string;
  label: string;
  kind: ChipKind;
  tint: string;
  jams: JamFromList[];
  now: Date;
}) {
  return (
    <section className="flex flex-col">
      <header className="flex items-center justify-between border-b border-muted/20 px-4 py-2">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          <span aria-hidden className={`mr-1.5 ${tint}`}>
            {glyph}
          </span>
          {label}
        </Text>
        <Text monospace size="xs" variant="muted" className="tracking-widest tabular-nums">
          {jams.length}
        </Text>
      </header>
      <ul className="divide-y divide-muted/20">
        {jams.map((jam) => (
          <li key={jam.jamId}>
            <JamRow jam={jam} kind={kind} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function JamRow({ jam, kind, now }: { jam: JamFromList; kind: ChipKind; now: Date }) {
  const phase = jamPhase(jam, now);
  const state = effectiveJamState(jam.startsAt, jam.endsAt, now);
  const meta = describeKindAndDates(jam, kind);
  return (
    <Link
      href={jamUrl(jam.slug)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 active:bg-muted/40"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
            {jam.hosts[0]?.name ?? "COMMUNITY"}
            {jam.hashtag ? ` · ${jam.hashtag.toUpperCase()}` : ""}
          </Text>
        </div>
        <Text bold size="md" ellipsis>
          {jam.title}
        </Text>
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {meta} · {jam.entriesCount ?? 0} entries
        </Text>
      </div>
      <PhaseBadge phase={phase} state={state} />
    </Link>
  );
}

function describeKindAndDates(jam: JamFromList, kind: ChipKind): string {
  const range = formatJamShortDates(jam.startsAt, jam.endsAt) ?? "TBA";
  switch (kind) {
    case "starting":
      return `kicks off · ${range}`;
    case "deadline":
      return `submissions close · ${range}`;
    case "ending":
      return `voting closes · ${range}`;
  }
}

function PhaseBadge({
  phase,
  state,
}: {
  phase: ReturnType<typeof jamPhase>;
  state: ReturnType<typeof effectiveJamState>;
}) {
  if (state === "running") return <Badge variant="destructive">LIVE</Badge>;
  if (phase === "voting") return <Badge variant="warning">VOTING</Badge>;
  if (phase === "upcoming") return <Badge variant="secondary">SOON</Badge>;
  return <Badge variant="outline">ARCHIVE</Badge>;
}
