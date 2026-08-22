import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { profileLinkParams } from "@/lib/profile-links";
import { teamLinkParams } from "@/lib/team-links";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

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
    staleTime: STALE.listing,
  });

  const members = data?.members ?? [];
  const teams = data?.teams ?? [];
  const openPostCount = data?.openPostCount ?? 0;
  const joinable = phase === "upcoming" || phase === "running";
  // Declared intent is a *pre*-jam signal. Once the jam is over, who
  // actually shipped is the only claim worth rendering, and "said they'd
  // enter, didn't" is not a thing this page says about anyone.
  const declared = joinable ? (data?.declared ?? []) : [];

  // Nothing to say, and nothing to invite — most jams. The section
  // disappears rather than announcing its own emptiness.
  if (members.length === 0 && teams.length === 0 && openPostCount === 0 && !joinable) return null;

  return (
    <Section
      id="community"
      title="FROM BRACKEYS"
      blurb={
        members.length > 0
          ? `${members.length} member${members.length === 1 ? "" : "s"} shipped in this jam.`
          : declared.length > 0
            ? `${declared.length} member${declared.length === 1 ? "" : "s"} entering.`
            : joinable
              ? "Nobody from here has joined yet."
              : undefined
      }
    >
      {declared.length > 0 ? (
        <div className="flex flex-col gap-2">
          <MicroLabel>ENTERING</MicroLabel>
          <div className="flex flex-wrap gap-2">
            {declared.map((member) => (
              <Chonk
                key={member.profileId}
                variant="surface"
                size="sm"
                className="items-center gap-2 bg-card px-2.5 py-1.5 backdrop-blur-none"
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
                  size={20}
                />
                <Text as="span" size="xs" bold className="tracking-wider">
                  {member.username ?? "Unknown"}
                </Text>
              </Chonk>
            ))}
          </div>
        </div>
      ) : null}

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
              {/* The declared count is the stronger hook when nobody has
                  posted yet — "12 members entering" is a reason to be the
                  first to post, where "no teams recruiting" is a dead end. */}
              {openPostCount > 0
                ? `${openPostCount} team ${openPostCount === 1 ? "post" : "posts"} recruiting for this jam`
                : declared.length > 0
                  ? `${declared.length} member${declared.length === 1 ? "" : "s"} entering — nobody recruiting yet`
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
    </Section>
  );
}
