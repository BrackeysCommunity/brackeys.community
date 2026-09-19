/**
 * The one guild rank a member's badge names. Client-safe on purpose:
 * `lib/discord` holds the bot token and the role-id map, and this reads
 * only the resolved names cached on `developer_profiles.guildRoles`.
 *
 * Ordered high to low — a member holding several gets one badge, the
 * highest. Guru and BIP are community ranks, not staff: authorization
 * never reads this, and `isStaffMember` / `isAdmin` in `lib/discord`
 * remain the gates.
 */
export type GuildRank = "admin" | "moderator" | "staff" | "guru" | "bip";

const RANKS: readonly { name: string; rank: GuildRank }[] = [
  { name: "Admin", rank: "admin" },
  { name: "Moderator", rank: "moderator" },
  { name: "Staff", rank: "staff" },
  { name: "Guru", rank: "guru" },
  { name: "BIP", rank: "bip" },
];

export function guildRankOf(guildRoles: readonly string[] | null | undefined): GuildRank | null {
  if (!guildRoles?.length) return null;
  return RANKS.find((entry) => guildRoles.includes(entry.name))?.rank ?? null;
}

export const GUILD_RANK_LABELS: Record<GuildRank, string> = {
  admin: "Admin",
  moderator: "Moderator",
  staff: "Staff",
  guru: "Guru",
  bip: "BIP",
};

/** Staff ranks carry the primary badge; community ranks the quieter one. */
export function isStaffRank(rank: GuildRank): boolean {
  return rank === "admin" || rank === "moderator" || rank === "staff";
}
