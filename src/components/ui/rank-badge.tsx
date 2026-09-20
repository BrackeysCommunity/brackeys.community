import { Shield02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { GUILD_RANK_LABELS, type GuildRank, guildRankOf, isStaffRank } from "@/lib/guild-rank";
import { cn } from "@/lib/utils";

/**
 * The guild's own rank beside a member's name, on every surface that names
 * one — a mod reads as a mod before anyone reads their skills. Staff take
 * the primary badge; Guru and BIP the secondary, so a community rank never
 * passes for a staff one. Pass `roles` straight off an identity payload,
 * or `rank` where the surface has already resolved it.
 */
export function RankBadge({
  rank,
  roles,
  className,
}: {
  rank?: GuildRank | null;
  roles?: readonly string[] | null;
  className?: string;
}) {
  const resolved = rank ?? guildRankOf(roles);
  if (!resolved) return null;
  return (
    <Badge
      variant={isStaffRank(resolved) ? "default" : "secondary"}
      size="label"
      className={cn("gap-1.5 uppercase", className)}
      data-testid="rank-badge"
    >
      <HugeiconsIcon icon={Shield02Icon} />
      {GUILD_RANK_LABELS[resolved]}
    </Badge>
  );
}
