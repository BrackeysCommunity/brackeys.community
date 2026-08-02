import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Heading, Link, Text } from "@/components/ui/typography";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState, formatJamShortDates } from "@/lib/jam-countdown";

import {
  type ChipKind,
  type DayBuckets,
  dayKey,
  jamPhase,
  jamSignal,
  type JamFromList,
  jamUrl,
} from "./helpers";

interface DayDetailContentProps {
  day: Date;
  buckets: DayBuckets | undefined;
}

// Modal-side (open) — the shared-layout target, matching the jam
// spotlight so a day and a jam unfold with the same motion.
const MODAL_TRANSITION = { type: "spring" as const, duration: 0.45, bounce: 0.18 };

/** Shared `layoutId` linking a calendar day cell to its detail modal.
 * Exported so the grid can stamp the same id on the source cell. */
export function dayCellLayoutId(day: Date): string {
  return `day-cell-${dayKey(day)}`;
}

/**
 * Spotlight detail surface for a single calendar day. Carries the same
 * `layoutId` as the day cell that launched it, so framer grows the
 * panel out of the cell's bounding box (and shrinks it back on close) —
 * the same morph the jam bars get via `JamDetailModal`. Must be
 * rendered inside the grid's `LayoutGroup` so framer can track the
 * shared id across the portal boundary.
 */
export function DayDetailModal({
  day,
  buckets,
  onClose,
}: {
  day: Date | null;
  buckets: DayBuckets | undefined;
  onClose: () => void;
}) {
  const open = day != null;

  // Lock body scroll while open so wheel/touch input doesn't keep
  // scrolling the calendar behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {day ? (
        <>
          <motion.div
            key="day-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            style={{ touchAction: "none" }}
          />
          <motion.div
            key={`day-modal-${dayKey(day)}`}
            layoutId={dayCellLayoutId(day)}
            transition={MODAL_TRANSITION}
            style={{ borderRadius: 12 }}
            // Centered via pure CSS (`inset-0 m-auto h-fit`) so no
            // static translate competes with framer's layout transform.
            // The chonky lift is replicated statically for the same
            // reason — `chonk-emboss` sets its own transform.
            className="fixed inset-0 z-50 m-auto h-fit max-h-[80vh] w-[min(28rem,calc(100vw-2rem))] cursor-default overflow-hidden border border-[var(--emboss-shadow)] bg-card text-foreground shadow-[0_6px_0_0_var(--emboss-shadow)] [--emboss-shadow:var(--muted-foreground)]"
          >
            <motion.div
              // Content fades in behind the morphing surface rather
              // than stretching with it, so text never smears.
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
              className="flex max-h-[80vh] flex-col overflow-y-auto pb-3"
            >
              <DayDetailContent day={day} buckets={buckets} />
            </motion.div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
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
        <Text size="xs" variant="muted" className="tracking-widest">
          ◆ DAY DETAIL
        </Text>
        <Heading as="h3" size="lg" className="tracking-tight">
          {dateLabel}
        </Heading>
        <Text size="xs" variant="muted" className="tracking-widest">
          {total} EVENT{total === 1 ? "" : "S"}
        </Text>
      </header>

      {total === 0 ? (
        <Text
          as="div"
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
        <Text size="xs" variant="muted" className="tracking-widest">
          <span aria-hidden className={`mr-1.5 ${tint}`}>
            {glyph}
          </span>
          {label}
        </Text>
        <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
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
  // Phase-aware metric: joined counts are the signal before the
  // deadline (entries are definitionally 0 then); entries after.
  const signal = jamSignal(jam, now);
  return (
    <Link
      href={jamUrl(jam.slug)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 active:bg-muted/40"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            {jam.hosts[0]?.name ?? "COMMUNITY"}
            {jam.hashtag ? ` · ${jam.hashtag.toUpperCase()}` : ""}
          </Text>
        </div>
        <Text bold size="md" ellipsis>
          {jam.title}
        </Text>
        <Text size="xs" variant="muted" className="tracking-widest">
          {meta} · {signal.value.toLocaleString()} {signal.label.toLowerCase()}
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
