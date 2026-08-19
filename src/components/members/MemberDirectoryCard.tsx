import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatRate } from "@/lib/format-rate";
import { Censored } from "@/lib/hooks/use-censored";
import { memberName } from "@/lib/member-name";
import { profileLinkParams } from "@/lib/profile-links";
import { timezoneOffsetLabel } from "@/lib/timezones";
import type { client } from "@/orpc/client";

import { availabilityLabel } from "./members-filters";

type MembersPage = Awaited<ReturnType<typeof client.listMembers>>;
export type DirectoryMember = MembersPage["members"][number];

/**
 * A member as a directory tile: identity, what they say they do, the
 * stack they work in, and the two numbers that say whether the profile
 * is worth opening — what they've shipped and how many crews they're on.
 *
 * The whole tile is the link, so it's a chonk rather than a well: a well
 * is a debossed frame for readouts, and every tile here is a
 * destination. There are no actions on it — inviting or hiring runs
 * through the profile or a collab post, both of which need context a
 * card can't carry. Same construction as `TeamDirectoryCard`, so a
 * person and a crew read as the same kind of object in the same grid.
 *
 * `rank` is the standing on the most-active rail, shown nowhere else.
 */
export function MemberDirectoryCard({ member, rank }: { member: DirectoryMember; rank?: number }) {
  const name = memberName(member, "Unknown");
  // Hire terms, not profile facts: closed, they are not on offer.
  const rate = member.availableForWork
    ? formatRate(member.rateType, member.rateMin, member.rateMax, {
        negotiableLabel: "NEGOTIABLE",
      })
    : null;
  const commitment = member.availableForWork ? availabilityLabel(member.availability) : null;
  // Rendered as an offset, never local time — see the timezones lib.
  const tz = member.timezone ? timezoneOffsetLabel(member.timezone) : null;
  // The one-liner is the profile's own; `lookingFor` is what an "I'm
  // available" post would have said, and is the more useful sentence
  // when someone has written both — but only while they're open to work.
  const blurb = (member.availableForWork ? member.lookingFor : null) ?? member.tagline;

  return (
    <Chonk
      variant="surface"
      size="lg"
      render={<Link to="/profile/$userId" params={profileLinkParams(member)} aria-label={name} />}
      className="flex h-full flex-col gap-3 bg-card p-4 backdrop-blur-none"
    >
      <span className="flex items-start gap-3">
        <span className="relative shrink-0">
          <UserAvatar avatarUrl={member.avatarUrl} username={name} shape="round" size={44} />
          {rank != null ? (
            // Sits on the avatar rather than in the text column: on the
            // rail the tiles are narrow, and a numeral in the heading row
            // costs the name characters it can't spare.
            <span className="absolute -top-1 -left-1 inline-flex size-4.5 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-bold text-primary-foreground tabular-nums ring-2 ring-card">
              {rank}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Text
              as="span"
              bold
              size="sm"
              ellipsis
              className="min-w-0 flex-1 tracking-wider text-foreground uppercase"
            >
              {name}
            </Text>
            {member.availableForWork ? (
              <Badge variant="success" size="label">
                OPEN
              </Badge>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {member.urlStub ? <MicroLabel>/{member.urlStub}</MicroLabel> : null}
            {commitment ? (
              <Badge variant="outline" size="label" className="uppercase">
                {commitment}
              </Badge>
            ) : null}
            {tz ? (
              <Badge variant="outline" size="label" className="text-muted-foreground">
                {tz}
              </Badge>
            ) : null}
          </span>
        </span>
      </span>

      {blurb ? (
        <Text as="span" size="xs" variant="muted" className="line-clamp-2">
          <Censored>{blurb}</Censored>
        </Text>
      ) : null}

      {member.roles.length > 0 || member.skills.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {/* Roles lead: "Composer" is the claim, the stack is the detail. */}
          {member.roles.map((role) => (
            <Badge key={`role-${role.id}`} variant="secondary" size="label" className="uppercase">
              {role.name}
            </Badge>
          ))}
          {member.skills.map((skill) => (
            <Badge key={skill.id} variant="outline" size="label" className="uppercase">
              {skill.name}
            </Badge>
          ))}
          {member.hiddenSkillCount > 0 ? (
            <Badge variant="outline" size="label" className="text-muted-foreground">
              +{member.hiddenSkillCount}
            </Badge>
          ) : null}
        </span>
      ) : null}

      {/* The three counts the activity ranking is built from, so a place
          on the rail is legible from the tile rather than a black box.
          Ships lead and always show; the other two only when non-zero. */}
      <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1">
        <Text as="span" size="xs" variant="muted" className="tracking-widest tabular-nums">
          {member.shipCount} SHIPPED
          {member.teamCount > 0
            ? ` · ${member.teamCount} ${member.teamCount === 1 ? "TEAM" : "TEAMS"}`
            : ""}
          {member.postCount > 0
            ? ` · ${member.postCount} ${member.postCount === 1 ? "POST" : "POSTS"}`
            : ""}
        </Text>
        {rate ? (
          <Badge variant="outline" size="label" className="ml-auto border-primary/50 text-primary">
            {rate}
          </Badge>
        ) : null}
      </span>
    </Chonk>
  );
}
