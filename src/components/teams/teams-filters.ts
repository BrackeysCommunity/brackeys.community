/**
 * The directory's filter vocabulary, shared by the toolbar, the mobile
 * filter drawer, and the chip readout. It lives apart from the page so
 * those three can't drift — and so the page can import them without a
 * cycle back through its own module.
 *
 * Unlike the collab board, which keeps its filters in a store, the
 * directory's live entirely in the URL: every surface here takes the
 * current search object plus a writer, and there is no second copy.
 */

export type TeamsSort = "active" | "shipped" | "newest";

export interface TeamsSearch {
  q?: string;
  recruiting?: boolean;
  shipped?: boolean;
  skills?: number[];
  sort?: TeamsSort;
  /** Opens the create drawer on arrival — the entry point for deep links. */
  new?: boolean;
}

/** Merges a partial change into the URL search. */
export type SetTeamsSearch = (next: Partial<TeamsSearch>) => void;

/**
 * Sort presets. `short` is the drawer's segmented label, where three
 * options share one row and the menu's full phrasing doesn't fit.
 */
export const SORT_OPTIONS: { value: TeamsSort; label: string; short: string }[] = [
  { value: "active", label: "Recruiting first", short: "ACTIVE" },
  { value: "shipped", label: "Recently shipped", short: "SHIPPED" },
  { value: "newest", label: "Newest", short: "NEWEST" },
];

export const DEFAULT_SORT: TeamsSort = "active";

/**
 * URL search → the shape `listTeams` and its facet counts both take.
 * Shared so a number on the stack picker can't be computed under a
 * different filter set than the list it labels.
 */
export function teamFacetInput(search: TeamsSearch) {
  const skills = search.skills ?? [];
  return {
    search: search.q?.trim() || undefined,
    recruiting: search.recruiting || undefined,
    hasShipped: search.shipped || undefined,
    skillIds: skills.length > 0 ? skills : undefined,
  };
}

/** Constraints in force, ignoring sort — sort narrows nothing. */
export function countActiveTeamFilters(search: TeamsSearch): number {
  let count = 0;
  if (search.q?.trim()) count += 1;
  if (search.recruiting) count += 1;
  if (search.shipped) count += 1;
  count += search.skills?.length ?? 0;
  return count;
}

/** Names of the active filter groups, for `search_performed`. */
export function teamFilterKinds(search: TeamsSearch): string[] {
  const kinds: string[] = [];
  if (search.recruiting) kinds.push("recruiting");
  if (search.shipped) kinds.push("shipped");
  if (search.skills?.length) kinds.push("skills");
  return kinds;
}

/** The patch that drops every constraint. Sort survives a clear. */
export const CLEARED_TEAM_FILTERS: Partial<TeamsSearch> = {
  q: undefined,
  recruiting: undefined,
  shipped: undefined,
  skills: undefined,
};
