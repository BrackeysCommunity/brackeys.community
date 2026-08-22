import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";

import { type JamFromList, jamPhase } from "@/components/jams/JamCalendarPage/helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/**
 * The team-finding half of a jam surface. Someone reading an upcoming
 * jam's description is the single highest-intent teammate-seeker on the
 * site, and until this existed the only thing we offered them was a link
 * off to itch.io.
 *
 * The "find a team" button only shows while joining is still plausible —
 * for an archived jam it's an invitation to waste time. The post count
 * shows whenever there are posts, because "who was recruiting for this"
 * stays interesting after the fact.
 *
 * Rendered by both the board's quick-look modal and the jam detail page,
 * which is why it lives a level up from either.
 */
export function JamTeamCta({ jam, className }: { jam: JamFromList; className?: string }) {
  const phase = jamPhase(jam, new Date());
  const open = phase === "upcoming" || phase === "running";

  const { data } = useQuery({
    ...orpc.countPostsForJam.queryOptions({ input: { jamId: jam.jamId } }),
    staleTime: STALE.listing,
  });
  const postCount = data?.count ?? 0;

  if (!open && postCount === 0) return null;

  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      {open ? (
        <Button
          variant="default"
          size="sm"
          className="tracking-widest"
          // Renders an <a>, not a <button> — Base UI needs telling, or it
          // warns about losing native button semantics.
          nativeButton={false}
          render={<RouterLink to="/collab" search={{ new: true, jam: jam.jamId }} />}
        >
          <HugeiconsIcon icon={UserGroupIcon} size={13} />
          FIND A TEAM →
        </Button>
      ) : null}
      {postCount > 0 ? (
        <RouterLink
          to="/collab"
          search={{ jam: jam.jamId }}
          className="text-xs tracking-widest text-primary uppercase hover:underline"
        >
          {postCount} team {postCount === 1 ? "post" : "posts"} for this jam →
        </RouterLink>
      ) : null}
    </div>
  );
}
