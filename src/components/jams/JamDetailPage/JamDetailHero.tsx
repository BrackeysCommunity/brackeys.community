import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { Heading, Link, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { BACKDROP_TRANSFORM, itchImageSrcSet, itchImageUrl } from "@/lib/itch-image";
import { durationDays, formatCountdown, formatJamShortDates } from "@/lib/jam-countdown";
import { hostName, jamUrl } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

import { MILESTONE_GLYPH, MILESTONE_VARIANT } from "../JamCalendarPage/board/milestones";
import { useJamColor, useJamGradient } from "../JamCalendarPage/board/use-jam-color";
import { type JamPhase, jamStats, nextMilestone, safeThemeColor } from "../JamCalendarPage/helpers";
import { JamLifecycleStrip } from "./JamLifecycleStrip";
import type { JamDetailRow } from "./types";

/** Phase → the chip on the banner. Same vocabulary as the board's shelf
 * badges, so a jam reads as the same jam on both pages. */
const PHASE_BADGE: Record<
  JamPhase,
  { label: string; variant: "destructive" | "secondary" | "warning" | "outline" }
> = {
  running: { label: "LIVE", variant: "destructive" },
  upcoming: { label: "UPCOMING", variant: "secondary" },
  voting: { label: "VOTING", variant: "warning" },
  archive: { label: "CLOSED", variant: "outline" },
};

/**
 * The jam's masthead: banner, who's running it, the title, the whole
 * lifecycle, and every participation number we hold.
 *
 * The banner uses the modal's letterboxing trick — a blurred, over-scaled
 * copy of the art fills the frame behind an `object-contain` original —
 * because itch jam banners come in every aspect ratio and cropping them
 * destroys the poster the host designed.
 */
export function JamDetailHero({
  jam,
  phase,
  now,
  trackedEntries,
}: {
  jam: JamDetailRow;
  phase: JamPhase;
  now: Date;
  /** Entries we actually hold, for the "N tracked" caption under itch's
   * own count when the two disagree. */
  trackedEntries: number;
}) {
  const color = useJamColor(jam);
  const gradient = useJamGradient(jam);
  const badge = PHASE_BADGE[phase];
  const cohosts = jam.hosts.slice(1);
  const milestone = nextMilestone(jam, now);
  const countdown = milestone ? formatCountdown(milestone.date, now) : null;
  const stats = jamStats(jam);
  const duration = durationDays(jam.startsAt, jam.endsAt);
  const dates = formatJamShortDates(jam.startsAt, jam.endsAt);
  // The host's own page background, re-validated before it reaches a style
  // attribute — it's scraped text.
  const wash = safeThemeColor(jam.themeColor) ?? color;

  return (
    <Well className="overflow-hidden p-0">
      <div className="relative h-44 w-full shrink-0 overflow-hidden sm:h-56 lg:h-72">
        {jam.bannerUrl ? (
          <>
            <img
              src={itchImageUrl(jam.bannerUrl, BACKDROP_TRANSFORM)}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl saturate-150"
            />
            <img
              src={itchImageUrl(jam.bannerUrl, { width: 960, quality: 70 })}
              srcSet={itchImageSrcSet(jam.bannerUrl, undefined, { quality: 70 })}
              sizes="100vw"
              alt={`${jam.title} banner`}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </>
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
          >
            <DotGrid />
          </div>
        )}
        {/* Eases the art into the body so a light banner doesn't butt
            against the panel edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
        />
        <div className="absolute top-3 left-3">
          <Badge variant={badge.variant} size="label">
            {badge.label}
          </Badge>
        </div>
      </div>

      <div className="relative flex flex-col gap-4 p-4 sm:p-6">
        {/* The theme colour as a wash rather than a fill: the host chose it
            for their page and it's often fully saturated, which no amount
            of body copy survives sitting on top of. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `color-mix(in srgb, ${wash} 8%, transparent)` }}
        />

        <div className="relative flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" size="label" className="uppercase">
              {hostName(jam)}
            </Badge>
            {cohosts.map((host) => (
              <Badge key={host.name} variant="outline" size="label" className="uppercase">
                {host.name}
              </Badge>
            ))}
            {jam.hashtag ? <MicroLabel>{jam.hashtag.toUpperCase()}</MicroLabel> : null}
          </div>

          <Heading as="h1" className="text-3xl leading-tight md:text-4xl">
            {jam.title}
          </Heading>

          <MicroLabel as="div">
            {dates ?? "DATES TBA"}
            {duration ? ` · ${duration}` : ""}
          </MicroLabel>
        </div>

        <div className="relative">
          <JamLifecycleStrip jam={jam} now={now} />
        </div>

        <div className="relative flex flex-wrap items-end gap-x-8 gap-y-3">
          {milestone ? (
            <HeroStat
              label={`${MILESTONE_GLYPH[milestone.kind]} ${milestone.label}`}
              value={countdown && !countdown.past ? countdown.text.toUpperCase() : "—"}
              tint={MILESTONE_VARIANT[milestone.kind]}
            />
          ) : null}
          {stats.map((stat) => (
            <HeroStat key={stat.label} label={stat.label} value={stat.value.toLocaleString()} />
          ))}
          {/* Only worth saying when it contradicts itch's number: a jam we
              scraped mid-voting can hold fewer entries than itch reports. */}
          {trackedEntries > 0 && trackedEntries !== jam.entriesCount ? (
            <HeroStat label="TRACKED HERE" value={trackedEntries.toLocaleString()} />
          ) : null}

          <Link
            href={jamUrl(jam.slug)}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            className="ml-auto tracking-widest uppercase"
          >
            View on itch.io →
          </Link>
        </div>
      </div>
    </Well>
  );
}

function HeroStat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: "primary" | "warning" | "destructive";
}) {
  return (
    <div className="min-w-0">
      <MicroLabel as="div">{label}</MicroLabel>
      <Text
        as="div"
        bold
        density="dense"
        className={cn(
          "text-xl whitespace-nowrap tabular-nums md:text-2xl",
          tint === "primary" && "text-primary",
          tint === "warning" && "text-warning",
          tint === "destructive" && "text-destructive",
        )}
      >
        {value}
      </Text>
    </div>
  );
}
