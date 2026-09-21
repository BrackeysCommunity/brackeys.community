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

/**
 * The guild's own role icons, vendored under `public/role-icons/` rather
 * than hotlinked off Discord's CDN — the badge renders on every surface
 * that names a member, and none of them should wait on discord.com.
 *
 * Staff is absent because the role carries no icon in the guild; its badge
 * is text-only rather than borrowing another role's art. Re-pull with
 * `GET /guilds/{id}/roles` if the server's icons change — the URL is
 * `cdn.discordapp.com/role-icons/{role_id}/{icon_hash}.png`.
 */
export const GUILD_RANK_ICONS: Partial<Record<GuildRank, string>> = {
  admin: "/role-icons/admin.png",
  moderator: "/role-icons/moderator.png",
  guru: "/role-icons/guru.png",
  bip: "/role-icons/bip.png",
};

export const GUILD_RANK_LABELS: Record<GuildRank, string> = {
  admin: "Admin",
  // "Mod" is what the role is actually called in the guild; the `moderator`
  // key stays, since that's the name `resolveRoleNames` maps the id to.
  moderator: "Mod",
  staff: "Staff",
  guru: "Guru",
  bip: "BIP",
};

/** Staff ranks carry the primary badge; community ranks the quieter one. */
export function isStaffRank(rank: GuildRank): boolean {
  return rank === "admin" || rank === "moderator" || rank === "staff";
}
