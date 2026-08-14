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
  { value: "active", label: "RECRUITING FIRST", short: "ACTIVE" },
  { value: "shipped", label: "RECENTLY SHIPPED", short: "SHIPPED" },
  { value: "newest", label: "NEWEST", short: "NEWEST" },
];

export const DEFAULT_SORT: TeamsSort = "active";

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
  "tracking-widest aria-pressed:border-primary! aria-pressed:bg-[color-mix(in_oklab,var(--primary)_15%,var(--emboss-surface))]! aria-pressed:text-primary aria-pressed:[--emboss-shadow:var(--primary)]";

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

/** The patch that drops every constraint. Sort survives a clear. */
export const CLEARED_TEAM_FILTERS: Partial<TeamsSearch> = {
  q: undefined,
  recruiting: undefined,
  shipped: undefined,
  skills: undefined,
};
