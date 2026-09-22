import type * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  GUILD_RANK_ICONS,
  GUILD_RANK_LABELS,
  type GuildRank,
  guildRankOf,
  isStaffRank,
} from "@/lib/guild-rank";
import { useFlag } from "@/lib/hooks/use-flag";
import { cn } from "@/lib/utils";

/**
 * How a rank icon is painted. `gradient` masks the art and rebuilds the
 * sweep from theme tokens, which is what belongs inside a tinted pill.
 * `full` keeps the guild's original colors, for surfaces that sit on a
 * plain background and want the art as the server draws it.
 */
export type RankIconTone = "gradient" | "full";

/** The guild's role icon for a rank, or null for one that carries none. */
export function RankIcon({
  rank,
  tone = "gradient",
  className,
}: {
  rank: GuildRank;
  tone?: RankIconTone;
  className?: string;
}) {
  const src = GUILD_RANK_ICONS[rank];
  if (!src) return null;

  // Decorative: every surface that renders an icon names the rank beside it.
  if (tone === "full") {
    return <img src={src} alt="" aria-hidden className={cn("size-3.5 shrink-0", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn("rank-icon size-3.5 shrink-0", className)}
      style={{ "--rank-icon": `url(${src})` } as React.CSSProperties}
    />
  );
}

/**
 * The guild's own rank for a member, on every surface that names one — a
 * mod reads as a mod before anyone reads their skills. Staff take the
 * primary chip; Guru and BIP the secondary, so a community rank never
 * passes for a staff one. Pass `roles` straight off an identity payload,
 * or `rank` where the surface has already resolved it.
 *
 * Flat, round and in the sans face, unlike the label badges around it:
 * `UserAvatar` pins this over its own bottom edge, where a raised all-caps
 * mono pad read as a second control rather than as an attribute of the
 * person. Placement belongs to the avatar — pass roles to that, not this.
 *
 * Staff renders text-only: the role has no icon in the guild, and the
 * alternatives all meant showing art the server doesn't use for it.
 *
 * The icon's tone follows `server-role-icon-og-color` unless a call site
 * names one. That flag defaults off, so the first render is always the
 * theme-matched gradient and the guild's own colors arrive only once
 * PostHog says so — gate on it, don't rely on the first paint.
 */
export function RankBadge({
  rank,
  roles,
  tone,
  collapsible,
  className,
}: {
  rank?: GuildRank | null;
  roles?: readonly string[] | null;
  tone?: RankIconTone;
  /**
   * Rest as a circle around the icon alone and grow the name back on
   * hover. Driven by `group/avatar`, so it only means anything inside
   * `UserAvatar` — a chip standing on its own in a heading or a byline
   * would have nothing to hover and would never say the rank.
   */
  collapsible?: boolean;
  className?: string;
}) {
  const ogColor = useFlag("server-role-icon-og-color");
  const resolved = rank ?? guildRankOf(roles);
  if (!resolved) return null;
  const label = GUILD_RANK_LABELS[resolved];
  return (
    <Badge
      variant={isStaffRank(resolved) ? "default" : "secondary"}
      flat
      className={cn(
        "h-4.5 gap-1 rounded-full px-1.5 text-[11px]",
        // Square on the icon at rest, so the chip reads as a dot on the
        // frame until someone asks what it is, seated a few px low and
        // rising as it opens. `pointer-events-auto` undoes the badge's
        // own opt-out: the chip is inside `group/avatar`, so letting it
        // take the pointer is what keeps the group hovered once the name
        // has grown out past the avatar's own box.
        collapsible &&
          "pointer-events-auto translate-y-1 gap-0 px-0.5 transition-[gap,padding,translate] duration-150 ease-out group-hover/avatar:translate-y-0 group-hover/avatar:gap-1 group-hover/avatar:px-1.5 group-hover/avatar:duration-400 group-hover/avatar:ease-spring motion-reduce:transition-none",
        className,
      )}
      data-testid="rank-badge"
    >
      <RankIcon rank={resolved} tone={tone ?? (ogColor ? "full" : "gradient")} />
      {collapsible ? (
        // Width, fade and slide all ride one element and one hover
        // selector, so they cannot end up disagreeing about the state.
        // `min-w-0` is what lets a flex item go under its min-content; the
        // cap only has to clear the longest rank, and `transition` names
        // `translate` because that is the property Tailwind animates.
        <span className="max-w-0 min-w-0 -translate-x-1 overflow-hidden opacity-0 transition-[max-width,opacity,translate] duration-150 ease-out group-hover/avatar:max-w-24 group-hover/avatar:translate-x-0 group-hover/avatar:opacity-100 group-hover/avatar:duration-400 group-hover/avatar:ease-spring motion-reduce:transition-none">
          {label}
        </span>
      ) : (
        label
      )}
    </Badge>
  );
}
