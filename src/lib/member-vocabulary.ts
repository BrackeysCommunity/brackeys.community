/**
 * The member domain's availability vocabulary: the wire values (the
 * `updateProfile` / `listMembers` enum) and their one display spelling.
 * Before this module the label shipped in three spellings ("Full Time",
 * "Full-time", "Limited / occasional") across the profile page, the edit
 * flyout, and the members filters.
 *
 * Kept as an ordered list rather than a record so chips, selects, and
 * summaries read in the same most-to-least order everywhere.
 */

export const MEMBER_AVAILABILITY = ["full_time", "part_time", "limited"] as const;
export type MemberAvailability = (typeof MEMBER_AVAILABILITY)[number];

export const AVAILABILITY_OPTIONS: { value: MemberAvailability; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "limited", label: "Limited" },
];

export function availabilityLabel(value: string | null | undefined): string | null {
  return AVAILABILITY_OPTIONS.find((o) => o.value === value)?.label ?? null;
}
