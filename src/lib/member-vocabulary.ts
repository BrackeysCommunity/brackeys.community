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

/**
 * Directory sort keys, each with the direction it reads best in. The URL
 * only carries a direction when it departs from its key's default, so the
 * plain `?sort=rate` link keeps meaning "cheapest first".
 */
export const MEMBER_SORTS = ["active", "shipped", "newest", "rate", "commitment"] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const MEMBER_SORT_DEFAULT_DIR: Record<MemberSort, SortDirection> = {
  active: "desc",
  shipped: "desc",
  newest: "desc",
  rate: "asc",
  commitment: "desc",
};
