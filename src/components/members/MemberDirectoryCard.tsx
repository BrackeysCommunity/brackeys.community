import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Censored } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatRate } from "@/lib/format-rate";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";
import { profileLinkParams } from "@/lib/profile-links";
import { timezoneOffsetLabel } from "@/lib/timezones";
import type { client } from "@/orpc/client";

import { availabilityLabel } from "./members-filters";

type MembersPage = Awaited<ReturnType<typeof client.listMembers>>;
export type DirectoryMember = MembersPage["members"][number];

/**
 * How many chips the roles and the stack share between them. The server
 * sends up to three roles and six skills, and ten chips on a rail tile is
 * four rows of them with the name and the counts squeezed around the
 * outside — the tile stops being a summary and becomes a skill dump.
 * Roles are served first; whatever the stack can't fit joins the `+N`.
 */
const CARD_CHIPS = 5;

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
  const identity = useMemberIdentity();
  const name = identity.name(member, "Unknown");
  // Hire terms, not profile facts: closed, they are not on offer.
  const rate = member.availableForWork
    ? formatRate(member.rateType, member.rateMin, member.rateMax, {
        negotiableLabel: "NEGOTIABLE",
        currency: member.currency,
      })
    : null;
  const commitment = member.availableForWork ? availabilityLabel(member.availability) : null;
  // Rendered as an offset, never local time — see the timezones lib.
  const tz = member.timezone ? timezoneOffsetLabel(member.timezone) : null;
  // The one-liner is the profile's own; `lookingFor` is what an "I'm
  // available" post would have said, and is the more useful sentence
  // when someone has written both — but only while they're open to work.
  const blurb = (member.availableForWork ? member.lookingFor : null) ?? member.tagline;
  const skills = member.skills.slice(0, Math.max(0, CARD_CHIPS - member.roles.length));
  const overflow = member.hiddenSkillCount + (member.skills.length - skills.length);

  return (
    <Chonk
      variant="surface"
      size="lg"
      render={<Link to="/profile/$userId" params={profileLinkParams(member)} aria-label={name} />}
      className="flex h-full flex-col gap-3 bg-card p-4 backdrop-blur-none"
    >
      <span className="flex items-start gap-3">
        <span className="relative shrink-0">
          <UserAvatar
            avatarUrl={member.avatarUrl}
            guildAvatarUrl={member.guildAvatarUrl}
            username={name}
            guildRoles={member.guildRoles}
            shape="round"
            size={44}
          />
          {rank != null ? (
            // Sits on the avatar rather than in the text column: on the
            // rail the tiles are narrow, and a numeral in the heading row
            // costs the name characters it can't spare.
            <span className="absolute -top-1 -left-1 inline-flex size-4.5 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-bold text-primary-foreground tabular-nums ring-2 ring-card">
              {rank}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
          {/* Handle and offset are identity, not claims: quiet muted text
              rather than chips. As badges they were unshrinkable and ran
              off the side of a rail tile, and they crowded the name row
              with two more bordered boxes. */}
          {member.urlStub || tz ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              {member.urlStub ? (
                <MicroLabel as="span" ellipsis className="min-w-0">
                  /{member.urlStub}
                </MicroLabel>
              ) : null}
              {member.urlStub && tz ? (
                <MicroLabel as="span" className="shrink-0 opacity-50">
                  ·
                </MicroLabel>
              ) : null}
              {tz ? (
                <MicroLabel as="span" className="shrink-0">
                  {tz}
                </MicroLabel>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>

      {blurb ? (
        <Text as="span" size="xs" variant="muted" className="line-clamp-2">
          <Censored>{blurb}</Censored>
        </Text>
      ) : null}

      {member.roles.length > 0 || skills.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {/* Roles lead: "Composer" is the claim, the stack is the detail. */}
          {member.roles.map((role) => (
            <Badge key={`role-${role.id}`} variant="secondary" size="label" className="uppercase">
              {role.name}
            </Badge>
          ))}
          {skills.map((skill) => (
            <Badge key={skill.id} variant="outline" size="label" className="uppercase">
              {skill.name}
            </Badge>
          ))}
          {overflow > 0 ? (
            <Badge variant="outline" size="label" className="text-muted-foreground">
              +{overflow}
            </Badge>
          ) : null}
        </span>
      ) : null}

      {/* The three counts the activity ranking is built from, so a place
          on the rail is legible from the tile rather than a black box.
          Ships lead and always show; the other two only when non-zero.
          Capacity sits here beside the rate rather than under the name:
          both are hire terms, both disappear together when the member
          closes, and the pair wraps to its own line on a narrow tile
          instead of shouldering the counts off the edge. */}
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
        {commitment || rate ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {commitment ? (
              <Badge variant="outline" size="label" className="uppercase">
                {commitment}
              </Badge>
            ) : null}
            {rate ? (
              <Badge variant="outline" size="label" className="border-primary/50 text-primary">
                {rate}
              </Badge>
            ) : null}
          </span>
        ) : null}
      </span>
    </Chonk>
  );
}
