import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { ShelfHeader } from "@/components/ui/shelf-header";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { profileLinkParams } from "@/lib/profile-links";
import { teamLinkParams } from "@/lib/team-links";
import { orpc } from "@/orpc/client";

import type { JamPhase } from "../JamCalendarPage/helpers";

/**
 * Who from Brackeys is in this jam — the join nothing jam-side has ever
 * rendered, and the one thing this page has that itch's own jam page
 * doesn't.
 *
 * Covers both directions of participation: members and teams who
 * *shipped* (from the `jam_id` on their placements), and teams still
 * *forming* (open collab posts for the jam). An upcoming jam has only the
 * second kind, which is exactly when someone reading it needs it.
 *
 * Client-fetched rather than loaded with the page: it's a shelf below the
 * fold, it's empty for the overwhelming majority of the 21k tracked jams,
 * and it has nothing a crawler wants.
 */
export function JamCommunitySection({ jamId, phase }: { jamId: number; phase: JamPhase }) {
  const { data } = useQuery({
    ...orpc.getJamCommunity.queryOptions({ input: { jamId } }),
    staleTime: 60 * 1000,
  });

  const members = data?.members ?? [];
  const teams = data?.teams ?? [];
  const openPostCount = data?.openPostCount ?? 0;
  const joinable = phase === "upcoming" || phase === "running";

  // Nothing to say, and nothing to invite — most jams. The section
  // disappears rather than announcing its own emptiness.
  if (members.length === 0 && teams.length === 0 && openPostCount === 0 && !joinable) return null;

  return (
    <section className="flex flex-col gap-3">
      <ShelfHeader
        title="FROM BRACKEYS"
        variant="label"
        blurb={
          members.length > 0
            ? `${members.length} MEMBER${members.length === 1 ? "" : "S"} SHIPPED IN THIS JAM`
            : joinable
              ? "NOBODY FROM HERE HAS JOINED YET"
              : undefined
        }
      />

      {members.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => (
            <Chonk
              key={member.placementId}
              variant="surface"
              size="lg"
              className="items-center gap-3 bg-card p-3 backdrop-blur-none"
              render={
                <Link
                  to="/profile/$userId"
                  params={profileLinkParams({ id: member.profileId, urlStub: member.urlStub })}
                  aria-label={member.username ?? "Unknown member"}
                />
              }
            >
              <UserAvatar
                avatarUrl={member.avatarUrl}
                username={member.username}
                shape="round"
                size={36}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text as="span" size="sm" bold ellipsis className="min-w-0 tracking-wider">
                  {member.username ?? "Unknown"}
                </Text>
                <Text as="span" size="xs" variant="muted" ellipsis>
                  {member.entryTitle ?? "—"}
                </Text>
              </span>
              {member.rank != null ? (
                <Badge variant={member.rank <= 3 ? "warning" : "outline"} size="label">
                  #{member.rank}
                </Badge>
              ) : null}
            </Chonk>
          ))}
        </div>
      ) : null}

      {teams.length > 0 ? (
        <div className="flex flex-col gap-2">
          <MicroLabel>TEAMS</MicroLabel>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <Chonk
                key={team.placementId}
                variant="surface"
                size="sm"
                className="items-center gap-2 bg-card px-2.5 py-1.5 backdrop-blur-none"
                render={
                  <Link
                    to="/teams/$teamId"
                    params={teamLinkParams({ id: team.teamId, slug: team.slug })}
                    aria-label={team.name}
                  />
                }
              >
                <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={20} />
                <Text as="span" size="xs" bold className="tracking-wider">
                  {team.name}
                </Text>
                {team.entryTitle ? (
                  <MicroLabel ellipsis className="max-w-40">
                    {team.entryTitle}
                  </MicroLabel>
                ) : null}
              </Chonk>
            ))}
          </div>
        </div>
      ) : null}

      {/* Forming, not shipped: the other half of participation. */}
      {openPostCount > 0 || joinable ? (
        <Well
          variant="ghost"
          className="flex-row flex-wrap items-center justify-between gap-3 p-3 backdrop-blur-none"
        >
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={UserGroupIcon} size={14} className="text-muted-foreground" />
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              {openPostCount > 0
                ? `${openPostCount} team ${openPostCount === 1 ? "post" : "posts"} recruiting for this jam`
                : "No teams recruiting for this jam yet"}
            </Text>
          </div>
          <Link
            to="/collab"
            search={openPostCount > 0 ? { jam: jamId } : { new: true, jam: jamId }}
            className="font-mono text-[10px] tracking-widest text-primary uppercase hover:underline"
          >
            {openPostCount > 0 ? "SEE THE POSTS →" : "POST FOR A TEAMMATE →"}
          </Link>
        </Well>
      ) : null}
    </section>
  );
}
