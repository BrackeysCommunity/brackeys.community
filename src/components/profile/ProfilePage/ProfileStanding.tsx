import { Badge } from "@/components/ui/badge";
import { Well } from "@/components/ui/well";

import { DetailRow } from "./DetailRow";
import type { ProfileBadge, ProfileStats } from "./helpers";
import { ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileStandingSectionProps {
  index: string;
  badges: ProfileBadge[];
  stats: ProfileStats;
}

/**
 * `§NN STANDING` sidebar card — the member's server-wide summary:
 * badge chips (jam winner / available / etc.) above dashed-leader
 * count rows. Replaces the old four-up stat tile row; the same
 * numbers now read as a compact ledger.
 */
export function ProfileStandingSection({ index, badges, stats }: ProfileStandingSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader index={index} title="STANDING" />
      <Well className="gap-4 p-4">
        {badges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {badges.map((badge) => (
              <StandingBadge key={badge.label} badge={badge} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <DetailRow label="Projects shipped" value={stats.projectsShipped} />
          <DetailRow label="Jams entered" value={stats.jamsEntered} />
          {stats.jamsBestRank ? <DetailRow label="Best finish" value={stats.jamsBestRank} /> : null}
          <DetailRow label="Skills listed" value={stats.skillsListed} />
          {stats.streakDays > 0 ? (
            <DetailRow label="Streak" value={`${stats.streakDays} days`} />
          ) : null}
        </div>
      </Well>
    </section>
  );
}

function StandingBadge({ badge }: { badge: ProfileBadge }) {
  const variant: "secondary" | "warning" | "success" =
    badge.variant === "online" ? "success" : badge.variant === "winner" ? "warning" : "secondary";
  const glyph = badge.variant === "online" ? "●" : badge.variant === "winner" ? "♛" : "■";
  return (
    <Badge variant={variant} size="label" className="uppercase">
      <span aria-hidden className="mr-1">
        {glyph}
      </span>
      {badge.label}
    </Badge>
  );
}
