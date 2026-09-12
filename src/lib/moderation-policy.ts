/**
 * The single gate for staff powers over teams and profiles (plan 23).
 *
 * `"direct"` — staff execute immediately. `"propose"` — staff file a
 * proposal an admin executes; admins may also act directly. `"admin"` —
 * admins only, never proposable. Flipping an action to direct access
 * later is a one-line edit here; both paths share the same apply
 * helpers, so the audit trail keeps its shape either way.
 */
export const MOD_POWERS = {
  team_update: "propose",
  team_slug: "propose",
  team_image_clear: "propose",
  team_image_set: "propose",
  team_member_remove: "propose",
  // A direct roster insert, no invite handshake — the break-glass tool for
  // "the owner removed the wrong person". Propose-tier so a mod's use of it
  // still crosses an admin's desk.
  team_member_add: "propose",
  team_transfer: "propose",
  team_title_edit: "propose",
  team_project_update: "propose",
  team_project_remove: "propose",
  team_invite: "direct", // consent-gated by acceptance
  team_hide: "direct", // urgent + reversible
  team_delete: "admin", // never proposable
  // A project's visibility is the same lever as a team's hide: reversible,
  // and the row stays for staff to look at. Deleting one is a hard delete
  // with no evidence left but the log row, so it stays with admins.
  project_unpublish: "direct",
  project_delete: "admin",
  profile_update: "propose",
  profile_stub_reset: "propose",
} as const;

export type ModPowerAction = keyof typeof MOD_POWERS;
export type ModPowerTier = (typeof MOD_POWERS)[ModPowerAction];

/** The staff actor behind an override write; absent on the owner path. */
export type ModOverride = { actorId: string; reason: string | null };

/** The actions a proposal may carry — everything on the `propose` tier. */
export const PROPOSABLE_ACTIONS = (Object.keys(MOD_POWERS) as ModPowerAction[]).filter(
  (action) => MOD_POWERS[action] === "propose",
);

/** Whether this caller may execute `action` directly (not via a proposal). */
export function canOverride(
  action: ModPowerAction,
  caller: { isStaff: boolean; isAdmin: boolean },
): boolean {
  if (caller.isAdmin) return true;
  if (!caller.isStaff) return false;
  return MOD_POWERS[action] === "direct";
}
