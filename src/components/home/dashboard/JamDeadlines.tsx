import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { formatCountdown } from "@/lib/jam-countdown";
import { jamLinkParams } from "@/lib/jam-links";

import type { JamDeadline } from "./dashboard-derive";

/**
 * Countdowns for the jams the viewer already has a stake in — one they're
 * recruiting for, or one they applied to a post about. Derived from the posts
 * and applications the sections above already loaded, so this costs nothing
 * beyond the sort.
 */
export function JamDeadlines({ deadlines }: { deadlines: JamDeadline[] }) {
  const now = useDateNow();
  if (deadlines.length === 0) return null;

  return (
    <Section
      title="YOUR JAM CLOCKS"
      size="sm"
      blurb="Jams your posts and applications are tied to."
      action={<SectionAction to="/jams">JAM BOARD</SectionAction>}
    >
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {deadlines.map(({ jam, phase, at }) => {
            const countdown = formatCountdown(at, new Date(now));
            return (
              <li key={jam.jamId}>
                <RouterLink
                  to="/jams/$jamSlug"
                  params={jamLinkParams(jam)}
                  className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
                >
                  <Badge
                    variant={phase === "running" ? "success" : "outline"}
                    size="label"
                    className="shrink-0"
                  >
                    {phase === "running" ? "LIVE" : "SOON"}
                  </Badge>
                  <Text
                    as="div"
                    bold
                    ellipsis
                    size="md"
                    className="min-w-0 flex-1 group-hover:text-primary"
                  >
                    {jam.title ?? "Untitled jam"}
                  </Text>
                  <MicroLabel as="div" className="shrink-0 tabular-nums">
                    {phase === "running" ? "ENDS" : "STARTS"} {countdown?.text ?? "—"}
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
