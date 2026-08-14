/**
 * The member directory's filter vocabulary, shared by the toolbar, the
 * mobile filter drawer, and the chip readout — the same split the team
 * directory uses, and for the same reason: those three surfaces must not
 * drift, and the page needs to import them without a cycle back through
 * its own module.
 *
 * Every constraint lives in the URL, so a narrowed directory is
 * shareable.
 */

export type MembersSort = "active" | "newest" | "rate";
export type MemberAvailability = "full_time" | "part_time" | "limited";

export interface MembersSearch {
  q?: string;
  skills?: number[];
  /** Craft claims — the shared `collab_roles` vocabulary. */
  roles?: number[];
  availability?: MemberAvailability[];
  /** The profile's own "open to work" flag. */
  open?: boolean;
  /** Hourly ceiling in whole dollars — implies "has an hourly rate". */
  rate?: number;
  /** Timezone window in hours: "within ±N hours of me". Viewer-relative —
   *  the viewer's own offset is derived from the browser at query time,
   *  so the same link means the same thing to whoever opens it. */
  tz?: number;
  sort?: MembersSort;
}

/** Merges a partial change into the URL search. */
export type SetMembersSearch = (next: Partial<MembersSearch>) => void;

/**
 * Sort presets. `short` is the drawer's segmented label, where three
 * options share one row and the menu's full phrasing doesn't fit.
 */
export const SORT_OPTIONS: { value: MembersSort; label: string; short: string }[] = [
  { value: "active", label: "Most active", short: "ACTIVE" },
  { value: "newest", label: "Newest members", short: "NEWEST" },
  { value: "rate", label: "Lowest rate", short: "RATE" },
];

export const DEFAULT_SORT: MembersSort = "active";

/**
 * Commitment levels, in the profile's own vocabulary. Kept as an ordered
 * list rather than a record so the chips and the summary read in the
 * same most-to-least order everywhere.
 */
export const AVAILABILITY_OPTIONS: { value: MemberAvailability; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "limited", label: "Limited" },
];

/**
 * Rate is a ceiling, not a range: the question people actually bring to
 * a directory is "who fits my budget", and a two-handle slider is a lot
 * of interaction for one number. Bands rather than a free input so it
 * stays a chip you can click off. Hourly only — a fixed fee and an
 * hourly rate are not points on one scale.
 */
export const RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 25, label: "Under $25/hr" },
  { value: 50, label: "Under $50/hr" },
  { value: 100, label: "Under $100/hr" },
];

export function availabilityLabel(value: string | null | undefined): string | null {
  return AVAILABILITY_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/**
 * Timezone windows. Small and round on purpose: the question is "can we
 * pair-program", and ±3/±6/±9 hours are the three honest answers between
 * "same working day" and "we hand off overnight".
 */
export const TZ_OPTIONS: { value: number; label: string }[] = [
  { value: 3, label: "Within ±3h of me" },
  { value: 6, label: "Within ±6h of me" },
  { value: 9, label: "Within ±9h of me" },
];

/**
 * Shared look for the filter row's toggles. The depressed-while-on state
 * comes from `.chonk-emboss[aria-pressed="true"]` in the stylesheet — the
 * classes here only carry the color, and are `!` so they beat the outline
 * variant's own hover background rather than depending on rule order.
 *
 * The on-fill is mixed into the button surface rather than laid over it as
 * `primary/15`: an alpha fill replaces the variant's opaque background, and
 * the cards scrolling under the sticky toolbar show through the toggle.
 */
export const FILTER_TOGGLE =
  "tracking-widest uppercase aria-pressed:border-primary! aria-pressed:bg-[color-mix(in_oklab,var(--primary)_15%,var(--emboss-surface))]! aria-pressed:text-primary aria-pressed:[--emboss-shadow:var(--primary)]";

/**
 * URL search → the shape `listMembers` and its facet counts both take.
 * Shared so a number on the stack picker can't be computed under a
 * different filter set than the list it labels.
 */
export function memberFacetInput(search: MembersSearch) {
  const skills = search.skills ?? [];
  const roles = search.roles ?? [];
  const availability = search.availability ?? [];
  return {
    search: search.q?.trim() || undefined,
    skillIds: skills.length > 0 ? skills : undefined,
    roleIds: roles.length > 0 ? roles : undefined,
    availability: availability.length > 0 ? availability : undefined,
    openToWork: search.open || undefined,
    maxHourlyRate: search.rate,
    // The URL stores only the window; the viewer's own offset is computed
    // here, at query time, from the browser — DST-correct by construction.
    tzOffset: search.tz != null ? -new Date().getTimezoneOffset() : undefined,
    tzWithinHours: search.tz,
  };
}

/** Constraints in force, ignoring sort — sort narrows nothing. */
export function countActiveMemberFilters(search: MembersSearch): number {
  let count = 0;
  if (search.q?.trim()) count += 1;
  if (search.open) count += 1;
  if (search.rate != null) count += 1;
  if (search.tz != null) count += 1;
  count += search.skills?.length ?? 0;
  count += search.roles?.length ?? 0;
  count += search.availability?.length ?? 0;
  return count;
}

/** The patch that drops every constraint. Sort survives a clear. */
export const CLEARED_MEMBER_FILTERS: Partial<MembersSearch> = {
  q: undefined,
  skills: undefined,
  roles: undefined,
  availability: undefined,
  open: undefined,
  rate: undefined,
  tz: undefined,
};
