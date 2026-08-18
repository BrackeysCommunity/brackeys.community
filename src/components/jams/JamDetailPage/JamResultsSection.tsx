import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { itchImageUrl } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

import { safeThemeColor } from "../JamCalendarPage/helpers";
import type { JamResultsCriterion, JamResultsPlace } from "./types";

/** Podium tint by place. Gold/silver/bronze via the theme's own accents
 * rather than literal metal colours, which no theme here would survive. */
const PLACE_TINT = ["border-warning/60", "border-muted-foreground/50", "border-accent/40"];

/**
 * The jam's published placements.
 *
 * Overall gets the podium — it's the placement anyone would recognize, and
 * the covers are the reason to look. Every other criterion collapses to
 * its winner, because a jam with eight criteria × three places is a wall
 * of the same twelve games and the full table is a click away on itch.
 */
export function JamResultsSection({ criteria }: { criteria: JamResultsCriterion[] }) {
  if (criteria.length === 0) return null;

  const overall = criteria.find((c) => c.criterion.toLowerCase() === "overall");
  const rest = criteria.filter((c) => c !== overall);

  return (
    <Section
      id="results"
      title="RESULTS"
      blurb={
        overall
          ? `${overall.entrantCount.toLocaleString()} entries ranked.`
          : "Placements by criterion."
      }
    >
      {overall ? (
        // Capped width: the content column runs to 1920px, and three covers
        // sharing that are billboards rather than a podium. ~300px each puts
        // them a step above the submissions grid's cards, which is the
        // hierarchy the section wants.
        <div className="grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {overall.places.map((place, index) => (
            <PodiumCard
              key={place.entryId}
              place={place}
              entrantCount={overall.entrantCount}
              tint={PLACE_TINT[index] ?? PLACE_TINT[2]!}
            />
          ))}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
          {rest.map((criterion) => {
            const winner = criterion.places[0];
            if (!winner) return null;
            return (
              // Stacks on a phone: a criterion name, a game title and a
              // score can't share 375px. `truncate` sits on the anchor
              // itself — on an inner inline `<span>` it has no width to
              // measure against and the title overruns the badge.
              <div
                key={criterion.criterion}
                className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3"
              >
                <MicroLabel className="shrink-0 uppercase sm:w-32">
                  {criterion.criterion}
                </MicroLabel>
                <a
                  href={winner.gameUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-xs font-bold hover:text-primary hover:underline"
                >
                  {winner.gameTitle}
                </a>
                <div className="flex shrink-0 items-center gap-3">
                  {winner.authorName ? (
                    <MicroLabel ellipsis className="hidden max-w-40 sm:block">
                      {winner.authorName}
                    </MicroLabel>
                  ) : null}
                  <MicroLabel tabular>{formatScore(winner.score)}</MicroLabel>
                  <Badge variant="outline" size="label" className="shrink-0">
                    #1 / {criterion.entrantCount.toLocaleString()}
                  </Badge>
                </div>
              </div>
            );
          })}
        </Well>
      ) : null}
    </Section>
  );
}

function PodiumCard({
  place,
  entrantCount,
  tint,
}: {
  place: JamResultsPlace;
  entrantCount: number;
  tint: string;
}) {
  const cover = safeThemeColor(place.gameCoverColor) ?? "var(--muted)";
  return (
    <a
      href={place.gameUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group/place flex flex-col gap-2"
    >
      <div
        className={cn(
          "relative aspect-[63/50] w-full overflow-hidden rounded-lg border-2 transition-colors group-hover/place:border-primary",
          tint,
        )}
        style={{ background: cover }}
      >
        {place.gameCoverUrl ? (
          <img
            src={itchImageUrl(place.gameCoverUrl, { width: 640 })}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <DotGrid />
        )}
        <div className="absolute top-2 left-2">
          <Badge variant={place.rank === 1 ? "warning" : "secondary"} size="label">
            #{place.rank} / {entrantCount.toLocaleString()}
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <Text
          as="div"
          bold
          ellipsis
          density="compressed"
          className="group-hover/place:text-primary"
        >
          {place.gameTitle}
        </Text>
        <MicroLabel as="div" ellipsis>
          {place.authorName ?? "UNKNOWN"} · {formatScore(place.score)}
        </MicroLabel>
      </div>
    </a>
  );
}

/**
 * Scores come back as pg `numeric` strings (`"4.250"`). Two decimals is
 * how itch prints them; trailing precision is noise.
 */
function formatScore(score: string | number | null): string {
  if (score == null) return "—";
  const value = typeof score === "number" ? score : Number.parseFloat(score);
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}
