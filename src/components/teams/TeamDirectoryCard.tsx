import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Censored } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import type { client } from "@/orpc/client";

type TeamsPage = Awaited<ReturnType<typeof client.listTeams>>;
export type DirectoryTeam = TeamsPage["teams"][number];

/** The fields the tile reads. Structural rather than tied to `listTeams`,
 *  so `listMyTeams` — which carries `role` and no sort columns — renders
 *  through the same component. */
export type TeamCard = Pick<
  DirectoryTeam,
  | "id"
  | "slug"
  | "name"
  | "tagline"
  | "avatarUrl"
  | "recruiting"
  | "memberCount"
  | "members"
  | "projectCount"
  | "openPostCount"
  | "skills"
>;

/**
 * A team as a directory tile: identity, the one-liner, the roster's
 * stack, and the two numbers that say whether the page is worth
 * opening — who's on it and what they've shipped.
 *
 * The whole tile is the link, so it's a chonk rather than a well: a
 * well is a debossed frame for readouts, and every tile here is a
 * destination. There are no actions on it — joining runs through the
 * team page or a collab post, both of which need context a card can't
 * carry.
 *
 * `role` is the viewer's own standing on the team, shown only on the
 * shelf of teams they belong to.
 *
 * `onSelect` turns the tile into a choice instead of a destination —
 * the collab wizard picking which of your teams is behind a post. Same
 * card either way: the decision is made on the same three facts the
 * directory shows, so it shouldn't be made off a name in a list.
 */
export function TeamDirectoryCard({
  team,
  role,
  selected,
  onSelect,
}: {
  team: TeamCard;
  role?: string | null;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const hidden = team.memberCount - team.members.length;

  return (
    <Chonk
      variant={selected ? "default" : "surface"}
      size="lg"
      render={
        onSelect ? (
          <button type="button" aria-pressed={selected} onClick={onSelect} />
        ) : (
          <Link
            to="/teams/$teamId"
            params={{ teamId: team.slug || team.id }}
            aria-label={team.name}
          />
        )
      }
      className={cn(
        "flex h-full w-full flex-col gap-3 p-4 backdrop-blur-none",
        selected ? "border-primary" : "bg-card",
      )}
    >
      <span className="flex items-start gap-3">
        <UserAvatar avatarUrl={team.avatarUrl} username={team.name} shape="round" size={44} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Text
              as="span"
              bold
              size="sm"
              ellipsis
              className={cn(
                "min-w-0 flex-1 tracking-wider uppercase",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {team.name}
            </Text>
            {team.recruiting ? (
              <Badge variant="success" size="label">
                RECRUITING
              </Badge>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            <MicroLabel>/{team.slug}</MicroLabel>
            {role ? (
              <Badge variant="outline" size="label" className="uppercase">
                {role}
              </Badge>
            ) : null}
          </span>
        </span>
      </span>

      {team.tagline ? (
        <Text as="span" size="xs" variant="muted" className="line-clamp-2">
          <Censored>{team.tagline}</Censored>
        </Text>
      ) : null}

      {team.skills.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {team.skills.map((skill) => (
            <Badge key={skill.id} variant="outline" size="label" className="uppercase">
              {skill.name}
            </Badge>
          ))}
        </span>
      ) : null}

      <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1">
        <AvatarStack members={team.members} hidden={hidden} />
        <Text as="span" size="xs" variant="muted" className="tracking-widest tabular-nums">
          {team.memberCount} {team.memberCount === 1 ? "MEMBER" : "MEMBERS"}
          {team.projectCount > 0 ? ` · ${team.projectCount} SHIPPED` : ""}
        </Text>
        {team.openPostCount > 0 ? (
          <Badge variant="outline" size="label" className="ml-auto border-primary/50 text-primary">
            {team.openPostCount} OPEN {team.openPostCount === 1 ? "POST" : "POSTS"}
          </Badge>
        ) : null}
      </span>
    </Chonk>
  );
}

/**
 * Roster faces, overlapped. Each face carries a card-colored ring so the
 * overlap reads as depth instead of a collision, and the remainder is a
 * disc of the same diameter rather than a badge — a rectangle at the end
 * of a row of circles breaks the run.
 */
export function AvatarStack({
  members,
  hidden,
  size = 22,
}: {
  members: DirectoryTeam["members"];
  hidden: number;
  size?: number;
}) {
  if (members.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {members.map((member) => (
        <UserAvatar
          key={member.userId}
          avatarUrl={member.avatarUrl}
          username={member.username}
          shape="round"
          size={size}
          className="ring-2 ring-card"
        />
      ))}
      {hidden > 0 ? (
        <span
          // `relative` so it paints over the last face: the avatar primitive
          // is positioned, and a static sibling would slide under it.
          className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground tabular-nums ring-2 ring-card"
          style={{ width: size, height: size }}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}
