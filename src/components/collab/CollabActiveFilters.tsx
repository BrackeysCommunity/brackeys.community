import { useQuery } from "@tanstack/react-query";

import { ActiveFilterBar, type ActiveFilterChip } from "@/components/common/ActiveFilterBar";
import { compensationLabelShort, experienceLabel, postTypeLabel } from "@/lib/collab-vocabulary";
import { useRolesCatalog, useSkillsCatalog } from "@/lib/hooks/use-taxonomy";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { CLEARED_COLLAB_FILTERS, useCollabBoardSearch } from "./collab-filters";
import { useCollabResultCount } from "./use-collab-counts";

const STATUS_LABELS: Record<string, string> = {
  recruiting: "OPEN",
  party_full: "CLOSED",
};
/** Facet picks that still read as individual chips rather than a tally. */
const VISIBLE_FACET_CHIPS = 3;

/**
 * The board's live count plus one removable chip per active filter.
 * Every constraint in force is visible and individually undoable from
 * here — previously the only way to see what was applied was to read
 * the rail, and the only way to undo was to hunt for the right segment.
 */
export function CollabActiveFilters() {
  const { search, setSearch } = useCollabBoardSearch();
  const count = useCollabResultCount();

  const roleIds = search.roles ?? [];
  const skillIds = search.skills ?? [];

  // Only fetched to name the ids the chips carry — all these lists are
  // small and already cached by the pickers that set these filters.
  const { data: jamData } = useQuery({
    ...orpc.listJams.queryOptions({ input: { filter: "board", limit: 500 } }),
    enabled: search.jam !== undefined,
    staleTime: STALE.jam,
  });
  const { data: roleData } = useRolesCatalog({ enabled: roleIds.length > 0 });
  const { data: skillData } = useSkillsCatalog({ enabled: skillIds.length > 0 });
  const { data: teamData } = useQuery({
    ...orpc.getTeam.queryOptions({ input: { teamId: search.team ?? "" } }),
    enabled: search.team !== undefined,
    staleTime: STALE.taxonomy,
  });
  const { data: projectData } = useQuery({
    ...orpc.getProject.queryOptions({ input: { idOrSlug: search.project ?? "" } }),
    enabled: search.project !== undefined,
    staleTime: STALE.taxonomy,
  });

  const chips: ActiveFilterChip[] = [];
  if (search.type) {
    chips.push({
      key: "type",
      label: postTypeLabel(search.type),
      clear: () => setSearch({ type: undefined }),
    });
  }
  if (search.status) {
    chips.push({
      key: "status",
      label: STATUS_LABELS[search.status] ?? search.status,
      clear: () => setSearch({ status: undefined }),
    });
  }
  if (search.level) {
    chips.push({
      key: "level",
      label: experienceLabel(search.level).toUpperCase(),
      clear: () => setSearch({ level: undefined }),
    });
  }
  if (search.comp) {
    chips.push({
      key: "comp",
      label: compensationLabelShort(search.comp).toUpperCase(),
      clear: () => setSearch({ comp: undefined }),
    });
  }
  if (search.solo !== undefined) {
    chips.push({
      key: "solo",
      label: search.solo ? "SOLO" : "HAS A CREW",
      clear: () => setSearch({ solo: undefined }),
    });
  }
  if (search.jam !== undefined) {
    const jam = jamData?.jams.find((j) => j.jamId === search.jam);
    chips.push({
      key: "jam",
      label: (jam?.title ?? `JAM #${search.jam}`).toUpperCase(),
      clear: () => setSearch({ jam: undefined }),
    });
  }
  if (search.team !== undefined) {
    chips.push({
      key: "team",
      label: `TEAM: ${(teamData?.name ?? "…").toUpperCase()}`,
      clear: () => setSearch({ team: undefined }),
    });
  }
  if (search.project !== undefined) {
    chips.push({
      key: "project",
      label: `PROJECT: ${(projectData?.project.title ?? "…").toUpperCase()}`,
      clear: () => setSearch({ project: undefined }),
    });
  }
  // Multi-value facets can hold a dozen values at once, and a chip apiece
  // pushed the board itself below the fold. Past a couple, they collapse
  // into one chip that clears the lot — the picker is where an individual
  // entry comes back off.
  if (roleIds.length > VISIBLE_FACET_CHIPS) {
    chips.push({
      key: "roles",
      label: `ROLES · ${roleIds.length}`,
      clear: () => setSearch({ roles: undefined }),
    });
  } else {
    for (const roleId of roleIds) {
      const role = roleData?.find((r) => r.id === roleId);
      chips.push({
        key: `role-${roleId}`,
        label: (role?.name ?? `#${roleId}`).toUpperCase(),
        clear: () => {
          const remaining = roleIds.filter((id) => id !== roleId);
          setSearch({ roles: remaining.length > 0 ? remaining : undefined });
        },
      });
    }
  }
  if (skillIds.length > VISIBLE_FACET_CHIPS) {
    chips.push({
      key: "skills",
      label: `STACK · ${skillIds.length}`,
      clear: () => setSearch({ skills: undefined }),
    });
  } else {
    for (const skillId of skillIds) {
      const skill = skillData?.find((s) => s.id === skillId);
      chips.push({
        key: `skill-${skillId}`,
        label: (skill?.name ?? `#${skillId}`).toUpperCase(),
        clear: () => {
          const remaining = skillIds.filter((id) => id !== skillId);
          setSearch({ skills: remaining.length > 0 ? remaining : undefined });
        },
      });
    }
  }
  if (search.q) {
    chips.push({
      key: "search",
      label: `“${search.q}”`,
      clear: () => setSearch({ q: undefined }),
    });
  }

  return (
    <ActiveFilterBar
      count={count}
      noun={["POST", "POSTS"]}
      chips={chips}
      onClearAll={() => setSearch(CLEARED_COLLAB_FILTERS)}
      matchAll={
        skillIds.length > 1
          ? {
              pressed: !!search.matchAll,
              toggle: () => setSearch({ matchAll: search.matchAll ? undefined : true }),
            }
          : undefined
      }
    />
  );
}
