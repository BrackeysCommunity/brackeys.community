import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatCount } from "@/lib/format-count";
import { profileLinkParams } from "@/lib/profile-links";
import { platformLabel } from "@/lib/project-taxonomy";
import { cn } from "@/lib/utils";

import { safeThemeColor } from "../JamCalendarPage/helpers";
import type { JamEntryRow } from "./types";

/**
 * One submission. The cover is the whole point, so it leads at itch's own
 * 630×500 aspect, over the scraped `cover_color` so a slow or missing
 * image still reads as the game's own tile rather than a grey hole.
 *
 * Links inward to `/projects/$slug` when the game has a canonical project
 * here, and to the mint-on-visit route otherwise — `rel="nofollow"` so a
 * crawler walking a 3k-entry grid doesn't mint 3k rows; the itch link lives
 * on the project page it lands on.
 */
export function JamEntryCard({
  entry,
  projectSlug,
}: {
  entry: JamEntryRow;
  /** Canonical project for this entry's game, when one exists. */
  projectSlug?: string | null;
}) {
  // Scraped text never reaches a style attribute without re-validation.
  const cover = safeThemeColor(entry.gameCoverColor) ?? "var(--muted)";
  const platforms = entry.gamePlatforms ?? [];

  const body = (
    <>
      <div
        className="relative aspect-[63/50] w-full overflow-hidden rounded border border-muted/40 transition-colors group-hover/entry:border-primary"
        style={{ background: cover }}
      >
        {entry.gameCoverUrl ? (
          <HoverPlayImage
            src={entry.gameCoverUrl}
            transform={{ width: 480 }}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <DotGrid />
        )}
        {entry.rank != null ? (
          <div className="absolute top-1 left-1">
            <Badge variant={entry.rank <= 3 ? "default" : "secondary"} size="label">
              #{entry.rank}
            </Badge>
          </div>
        ) : null}
        {entry.ratingCount > 0 ? (
          <div className="absolute right-1 bottom-1 rounded bg-background/80 px-1.5 py-0.5 backdrop-blur-sm">
            <MicroLabel variant="primary" tabular>
              {formatCount(entry.ratingCount)} ★
            </MicroLabel>
          </div>
        ) : null}
      </div>

      <Text
        as="div"
        size="sm"
        bold
        ellipsis
        density="compressed"
        className="group-hover/entry:text-primary"
      >
        {entry.gameTitle}
      </Text>

      <div className="flex items-center gap-1.5">
        <MicroLabel as="div" ellipsis className="min-w-0 flex-1">
          {entry.authorName ?? "UNKNOWN"}
        </MicroLabel>
        {platforms.slice(0, 3).map((platform) => (
          <MicroLabel key={platform} className={cn("shrink-0 opacity-70")}>
            {platformLabel(platform)}
          </MicroLabel>
        ))}
      </div>
    </>
  );

  const target = projectSlug ? (
    <RouterLink
      to="/projects/$projectSlug"
      params={{ projectSlug }}
      className="flex flex-col gap-1.5"
    >
      {body}
    </RouterLink>
  ) : (
    <RouterLink
      to="/projects/game/$gameId"
      params={{ gameId: String(entry.gameId) }}
      rel="nofollow"
      className="flex flex-col gap-1.5"
    >
      {body}
    </RouterLink>
  );

  // A member chip has to be its own link (to their profile), and a link
  // can't nest inside the card's link — so when there are chips the card
  // root becomes a plain wrapper with the cover/title anchor inside it.
  if (entry.members.length === 0) {
    return (
      <div data-hover-play-group className="group/entry flex flex-col gap-1.5">
        {target}
      </div>
    );
  }

  return (
    <div data-hover-play-group className="group/entry flex flex-col gap-1.5">
      {target}
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.members.map((member) => (
          <RouterLink
            key={member.profileId}
            to="/profile/$userId"
            params={profileLinkParams({ id: member.profileId, urlStub: member.urlStub })}
            className="flex min-w-0 items-center gap-1.5 hover:text-primary"
            aria-label={`${member.username ?? "Member"} on Brackeys`}
          >
            <UserAvatar
              avatarUrl={member.avatarUrl}
              username={member.username}
              shape="round"
              size={16}
            />
            <Badge variant="default" size="label">
              BRACKEYS
            </Badge>
            <MicroLabel ellipsis variant="primary" className="min-w-0">
              {member.username ?? "MEMBER"}
            </MicroLabel>
          </RouterLink>
        ))}
      </div>
    </div>
  );
}
