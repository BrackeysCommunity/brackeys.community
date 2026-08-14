import { Link as RouterLink } from "@tanstack/react-router";

import { jamPhase, type JamPhase } from "@/components/jams/JamCalendarPage/helpers";
import { Badge } from "@/components/ui/badge";
import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { formatCountdown } from "@/lib/jam-countdown";
import { jamLinkParams } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

/** Derived from the procedure rather than restated, the same way
 *  `JamFromList` is — a hand-written copy drifts the moment the payload does. */
export type WatchedJam = Awaited<
  ReturnType<typeof import("@/orpc/client").client.listMyJamWatches>
>["jams"][number];

/** Which clock a jam is on, and what to call it. */
function nextEvent(phase: JamPhase, jam: WatchedJam): { label: string; at: Date } | null {
  if (phase === "upcoming" && jam.startsAt) return { label: "STARTS", at: jam.startsAt };
  if (phase === "running" && jam.endsAt) return { label: "ENDS", at: jam.endsAt };
  if (phase === "voting" && jam.votingEndsAt) return { label: "VOTING ENDS", at: jam.votingEndsAt };
  return null;
}

/**
 * Jams the viewer asked to be kept on. Distinct from YOUR JAM CLOCKS above
 * it, which is derived from posts and applications — this is the list they
 * chose, so it stands even when they haven't posted anything yet. That is
 * the point: watching is the affordance for a member who is interested
 * before they are committed.
 *
 * A jam that disappeared from itch renders struck-through rather than
 * vanishing. The scraper tombstones rows it stops finding, and silently
 * dropping one would look like the app forgot.
 */
export function WatchedJams({ jams }: { jams: WatchedJam[] }) {
  const now = useDateNow();
  if (jams.length === 0) return null;

  return (
    <Section
      title="JAMS YOU'RE WATCHING"
      size="sm"
      blurb="The ones you asked to be reminded about."
      action={<SectionAction to="/jams">JAM BOARD</SectionAction>}
    >
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {jams.map((jam) => {
            const phase = jamPhase(jam, new Date(now));
            const event = nextEvent(phase, jam);
            const countdown = event ? formatCountdown(event.at, new Date(now)) : null;
            const gone = jam.missingSince != null;
            return (
              <li key={jam.jamId}>
                <RouterLink
                  to="/jams/$jamSlug"
                  params={jamLinkParams(jam)}
                  className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
                >
                  <Badge
                    variant={
                      jam.intent === "entering"
                        ? "success"
                        : phase === "running"
                          ? "warning"
                          : "outline"
                    }
                    size="label"
                    className="shrink-0"
                  >
                    {jam.intent === "entering" ? "ENTERING" : "WATCHING"}
                  </Badge>
                  <Text
                    as="div"
                    bold
                    ellipsis
                    size="md"
                    className={cn(
                      "min-w-0 flex-1 group-hover:text-primary",
                      gone && "text-muted-foreground line-through",
                    )}
                  >
                    {jam.title}
                  </Text>
                  <MicroLabel as="div" className="shrink-0 tabular-nums">
                    {gone
                      ? "GONE FROM ITCH"
                      : event && countdown
                        ? `${event.label} ${countdown.text}`
                        : "—"}
                  </MicroLabel>
                </RouterLink>
              </li>
            );
          })}
        </ul>
      </Well>
    </Section>
  );
}
