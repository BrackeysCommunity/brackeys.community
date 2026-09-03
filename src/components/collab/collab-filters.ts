import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import type {
  CollabCompensationType,
  CollabExperienceLevel,
  CollabPostType,
  CollabSortBy,
  CollabSortOrder,
  CollabStatus,
} from "@/lib/collab-store";

/**
 * The board's filter vocabulary, shared by the toolbar, the mobile filter
 * drawer, the chip readout, and the idle inspector — the same split the
 * team and member directories use, and for the same reason: those
 * surfaces must not drift, and the page needs to import them without a
 * cycle back through its own module.
 *
 * Every constraint lives in the URL, so a narrowed board is shareable —
 * `collabStore` keeps only what isn't a filter (layout, the wizard
 * draft).
 */

export type CollabBoardSort = "newest" | "oldest" | "active";

export interface CollabBoardSearch {
  /** Opens the create flyout on arrival. Alongside it, `jam`/`team`/
   *  `project` address the wizard (preselect) rather than the board. */
  new?: boolean;
  /** With `new`: open the five-step wizard instead of the one-screen post. */
  flow?: "wizard";
  /** The selected post — the inspector pane / detail overlay. */
  post?: number;
  type?: CollabPostType;
  status?: CollabStatus;
  /** Absence means any — the UI's "any" sentinel never reaches the URL. */
  level?: Exclude<CollabExperienceLevel, "any">;
  comp?: CollabCompensationType;
  /** true = solo posts, false = team posts, absent = both. */
  solo?: boolean;
  q?: string;
  roles?: number[];
  skills?: number[];
  /** Skills combine as all-of instead of the default any-of. A modifier
   *  on `skills`, not a constraint of its own — it only reaches the
   *  server alongside two or more picked skills, where the two modes
   *  can actually disagree. */
  matchAll?: boolean;
  jam?: number;
  team?: string;
  project?: string;
  sort?: CollabBoardSort;
}

/** Merges a partial change into the URL search. */
export type SetCollabSearch = (next: Partial<CollabBoardSearch>) => void;

/**
 * Sort presets pair a column with a direction — one choice, no separate
 * order toggle to keep in sync.
 */
export const SORT_OPTIONS: {
  value: CollabBoardSort;
  label: string;
  by: CollabSortBy;
  order: CollabSortOrder;
}[] = [
  { value: "newest", label: "Newest", by: "createdAt", order: "desc" },
  { value: "oldest", label: "Oldest", by: "createdAt", order: "asc" },
  { value: "active", label: "Recently active", by: "updatedAt", order: "desc" },
];

export const DEFAULT_SORT: CollabBoardSort = "newest";

/** The column/direction pair behind a sort value, defaulting to newest. */
export function sortPreset(sort: CollabBoardSort | undefined) {
  return SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0];
}

/**
 * URL search → the shape `listPosts` and its facet counts both take.
 * Shared so a number on a picker can't be computed under a different
 * filter set than the list it labels.
 */
export function collabFacetInput(search: CollabBoardSearch) {
  const roles = search.roles ?? [];
  const skills = search.skills ?? [];
  return {
    type: search.type,
    status: search.status,
    search: search.q?.trim() || undefined,
    experienceLevel: search.level,
    compensationType: search.comp,
    isIndividual: search.solo,
    roleIds: roles.length > 0 ? roles : undefined,
    skillIds: skills.length > 0 ? skills : undefined,
    matchAll: skills.length > 1 && search.matchAll ? true : undefined,
    jamId: search.jam,
    teamId: search.team,
    projectId: search.project,
  };
}

/**
 * Everything the board's listing query is keyed on, and nothing else: the
 * URL also carries `new` and `post`, which address the create flyout and
 * the inspector rather than the list. `/collab`'s loader takes this as its
 * `loaderDeps`, so opening a post doesn't re-run the prefetch.
 */
export function collabListingDeps(search: CollabBoardSearch) {
  const { by: sortBy, order: sortOrder } = sortPreset(search.sort);
  return { filters: collabFacetInput(search), sortBy, sortOrder };
}

export type CollabListingDeps = ReturnType<typeof collabListingDeps>;

/** Names of the active filter groups, for `search_performed`. */
export function collabFilterKinds(search: CollabBoardSearch): string[] {
  const input = collabFacetInput(search);
  const kinds: string[] = [];
  if (input.type) kinds.push("type");
  if (input.status) kinds.push("status");
  if (input.experienceLevel) kinds.push("level");
  if (input.compensationType) kinds.push("comp");
  if (input.isIndividual !== undefined) kinds.push("solo");
  if (input.roleIds) kinds.push("roles");
  if (input.skillIds) kinds.push("skills");
  if (input.jamId != null) kinds.push("jam");
  if (input.teamId != null) kinds.push("team");
  if (input.projectId != null) kinds.push("project");
  return kinds;
}

/** Constraints in force, ignoring sort — sort narrows nothing. */
export function countActiveCollabFilters(search: CollabBoardSearch): number {
  const input = collabFacetInput(search);
  return [
    input.type,
    input.status,
    input.experienceLevel,
    input.compensationType,
    input.isIndividual !== undefined ? true : undefined,
    input.search,
    input.roleIds,
    input.skillIds,
    input.jamId,
    input.teamId,
    input.projectId,
  ].filter(Boolean).length;
}

/** The patch that drops every constraint. Sort survives a clear. */
export const CLEARED_COLLAB_FILTERS: Partial<CollabBoardSearch> = {
  type: undefined,
  status: undefined,
  level: undefined,
  comp: undefined,
  solo: undefined,
  q: undefined,
  roles: undefined,
  skills: undefined,
  matchAll: undefined,
  jam: undefined,
  team: undefined,
  project: undefined,
};

/**
 * The board's search params and their writer, for any component mounted
 * under `/collab/`. Writes `replace` because filtering is refinement, not
 * navigation — Back should leave the board, not undo one chip — and
 * `resetScroll: false` because a filter change shouldn't throw away the
 * reader's place in the list.
 */
export function useCollabBoardSearch() {
  const search = useSearch({ from: "/collab/" }) as CollabBoardSearch;
  const navigate = useNavigate({ from: "/collab/" });

  const setSearch: SetCollabSearch = useCallback(
    (next) => {
      navigate({
        search: (prev) => ({ ...prev, ...next }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return { search, setSearch };
}
