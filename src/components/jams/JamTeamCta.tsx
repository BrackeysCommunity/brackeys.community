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
 * Whether joining is still plausible, and how many posts are recruiting for
 * this jam. Both halves below read it, and they share one query key — so a
 * surface that renders them apart still costs a single fetch.
 */
function useJamTeamState(jam: JamFromList) {
  const phase = jamPhase(jam, new Date());
  const { data } = useQuery({
    ...orpc.countPostsForJam.queryOptions({ input: { jamId: jam.jamId } }),
    staleTime: STALE.listing,
  });
  return {
    open: phase === "upcoming" || phase === "running",
    postCount: data?.count ?? 0,
  };
}

/**
 * Only shown while joining is still plausible — for an archived jam it's an
 * invitation to waste time.
 */
export function JamFindTeamButton({ jam, className }: { jam: JamFromList; className?: string }) {
  const { open } = useJamTeamState(jam);
  if (!open) return null;

  return (
    <Button
      variant="default"
      size="sm"
      className={cn("tracking-widest", className)}
      tooltip="Post or browse team-ups for this jam"
      // Renders an <a>, not a <button> — Base UI needs telling, or it
      // warns about losing native button semantics.
      nativeButton={false}
      render={<RouterLink to="/collab" search={{ new: true, jam: jam.jamId }} />}
    >
      <HugeiconsIcon icon={UserGroupIcon} size={13} />
      FIND A TEAM
    </Button>
  );
}

/**
 * Shown whenever there are posts, including after the jam has run — "who was
 * recruiting for this" stays interesting after the fact.
 */
export function JamTeamPostsLink({ jam, className }: { jam: JamFromList; className?: string }) {
  const { postCount } = useJamTeamState(jam);
  if (postCount === 0) return null;

  return (
    <RouterLink
      to="/collab"
      search={{ jam: jam.jamId }}
      className={cn("text-xs tracking-widest text-primary uppercase hover:underline", className)}
    >
      {postCount} team {postCount === 1 ? "post" : "posts"}
      {/* The qualifier is only worth its width once the rail has room; the
          hidden half stays out of the accessibility tree either way. */}
      <span className="hidden sm:inline"> for this jam</span> →
    </RouterLink>
  );
}

/**
 * The team-finding half of a jam surface, stacked. Someone reading an
 * upcoming jam's description is the single highest-intent teammate-seeker on
 * the site, and until this existed the only thing we offered them was a link
 * off to itch.io.
 *
 * The detail page's CTA rail places the two halves itself — the button
 * belongs in the button row, the link on its own line beneath it — so they
 * are exported separately above; this is the stacked composition the board's
 * quick-look modal uses.
 */
export function JamTeamCta({ jam, className }: { jam: JamFromList; className?: string }) {
  const { open, postCount } = useJamTeamState(jam);
  if (!open && postCount === 0) return null;

  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <JamFindTeamButton jam={jam} />
      <JamTeamPostsLink jam={jam} />
    </div>
  );
}
