/**
 * The one guild role a member's staff badge names. Client-safe on purpose:
 * `lib/discord` holds the bot token and the role-id map, and this reads
 * only the resolved names cached on `developer_profiles.guildRoles`.
 *
 * Ordered by rank — an admin who also holds Moderator gets one badge, the
 * higher one. Authorization never reads this; `isStaffMember` / `isAdmin`
 * in `lib/discord` remain the gates.
 */
export type StaffRole = "admin" | "moderator" | "staff";

const STAFF_ROLES: readonly { name: string; role: StaffRole }[] = [
  { name: "Admin", role: "admin" },
  { name: "Moderator", role: "moderator" },
  { name: "Staff", role: "staff" },
];

export function staffRoleOf(guildRoles: readonly string[] | null | undefined): StaffRole | null {
  if (!guildRoles?.length) return null;
  return STAFF_ROLES.find((entry) => guildRoles.includes(entry.name))?.role ?? null;
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  moderator: "Moderator",
  staff: "Staff",
};
