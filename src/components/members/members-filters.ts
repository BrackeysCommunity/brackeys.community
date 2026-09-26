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

import {
  MEMBER_SORT_DEFAULT_DIR,
  type MemberAvailability,
  type MemberSort,
  type SortDirection,
} from "@/lib/member-vocabulary";

export { AVAILABILITY_OPTIONS, availabilityLabel } from "@/lib/member-vocabulary";
export type { MemberAvailability, SortDirection };

export type MembersSort = MemberSort;

export interface MembersSearch {
  q?: string;
  skills?: number[];
  /** Skills combine as all-of instead of the default any-of. A modifier
   *  on `skills`, not a constraint of its own — it only reaches the
   *  server alongside two or more picked skills, where the two modes
   *  can actually disagree. */
  matchAll?: boolean;
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
  /** Only present when it departs from the sort's natural direction. */
  dir?: SortDirection;
}

/** Merges a partial change into the URL search. */
export type SetMembersSearch = (next: Partial<MembersSearch>) => void;

/**
 * Sort keys. `short` is the drawer's chip label; `dirLabels` name the two
 * directions in the key's own terms, since "ascending commitment" makes
 * the reader do the mapping.
 */
export const SORT_OPTIONS: {
  value: MembersSort;
  label: string;
  short: string;
  dirLabels: Record<SortDirection, string>;
}[] = [
  {
    value: "active",
    label: "Activity",
    short: "ACTIVITY",
    dirLabels: { desc: "Most active first", asc: "Least active first" },
  },
  {
    value: "shipped",
    label: "Shipped projects",
    short: "SHIPPED",
    dirLabels: { desc: "Most shipped first", asc: "Fewest shipped first" },
  },
  {
    value: "newest",
    label: "Join date",
    short: "JOINED",
    dirLabels: { desc: "Newest first", asc: "Oldest first" },
  },
  {
    value: "rate",
    label: "Hourly rate",
    short: "RATE",
    dirLabels: { asc: "Lowest first", desc: "Highest first" },
  },
  {
    value: "commitment",
    label: "Commitment",
    short: "COMMITMENT",
    dirLabels: { desc: "Full-time first", asc: "Limited first" },
  },
];

export const DEFAULT_SORT: MembersSort = "active";

/** The URL patch for picking a sort key: its natural direction comes with it. */
export function sortPatch(sort: MembersSort): Partial<MembersSearch> {
  return { sort: sort === DEFAULT_SORT ? undefined : sort, dir: undefined };
}

/** The URL patch for a direction, dropped when it matches the key's default. */
export function sortDirPatch(sort: MembersSort, dir: SortDirection): Partial<MembersSearch> {
  return { dir: dir === MEMBER_SORT_DEFAULT_DIR[sort] ? undefined : dir };
}

export function effectiveSortDir(search: MembersSearch): SortDirection {
  return search.dir ?? MEMBER_SORT_DEFAULT_DIR[search.sort ?? DEFAULT_SORT];
}

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
    matchAll: skills.length > 1 && search.matchAll ? true : undefined,
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

/** Names of the active filter groups, for `search_performed`. */
export function memberFilterKinds(search: MembersSearch): string[] {
  const kinds: string[] = [];
  if (search.skills?.length) kinds.push("skills");
  if (search.roles?.length) kinds.push("roles");
  if (search.availability?.length) kinds.push("availability");
  if (search.open) kinds.push("open");
  if (search.rate != null) kinds.push("rate");
  if (search.tz != null) kinds.push("tz");
  return kinds;
}

/** The patch that drops every constraint. Sort survives a clear. */
export const CLEARED_MEMBER_FILTERS: Partial<MembersSearch> = {
  q: undefined,
  skills: undefined,
  matchAll: undefined,
  roles: undefined,
  availability: undefined,
  open: undefined,
  rate: undefined,
  tz: undefined,
};
