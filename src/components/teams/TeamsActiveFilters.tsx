import { ActiveFilterBar, type ActiveFilterChip } from "@/components/common/ActiveFilterBar";
import { useSkillsCatalog } from "@/lib/hooks/use-taxonomy";

import { CLEARED_TEAM_FILTERS, type SetTeamsSearch, type TeamsSearch } from "./teams-filters";

/**
 * The directory's live count plus one removable chip per active filter,
 * mirroring the collab board's readout. It carries the count because the
 * toolbar can't: on touch the toolbar is search alone and the controls
 * float by the thumb, so this is the only place the result of filtering
 * is stated — and the only place a single constraint can be undone
 * without reopening the drawer.
 */
export function TeamsActiveFilters({
  search,
  setSearch,
  count,
}: {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
  /** `null` while the listing is still loading. */
  count: number | null;
}) {
  const skillIds = search.skills ?? [];

  // Only fetched to name the ids the chips carry — already cached by the
  // pickers that set the filter.
  const { data: skillData } = useSkillsCatalog({ enabled: skillIds.length > 0 });

  const chips: ActiveFilterChip[] = [];
  if (search.recruiting) {
    chips.push({
      key: "recruiting",
      label: "RECRUITING",
      clear: () => setSearch({ recruiting: undefined }),
    });
  }
  if (search.shipped) {
    chips.push({
      key: "shipped",
      label: "HAS SHIPPED",
      clear: () => setSearch({ shipped: undefined }),
    });
  }
  for (const skillId of skillIds) {
    const skill = skillData?.find((s) => s.id === skillId);
    chips.push({
      key: `skill-${skillId}`,
      label: (skill?.name ?? `#${skillId}`).toUpperCase(),
      clear: () => setSearch({ skills: skillIds.filter((id) => id !== skillId) }),
    });
  }
  if (search.q?.trim()) {
    chips.push({
      key: "q",
      label: `“${search.q}”`,
      clear: () => setSearch({ q: undefined }),
    });
  }

  return (
    <ActiveFilterBar
      count={count}
      noun={["TEAM", "TEAMS"]}
      chips={chips}
      onClearAll={() => setSearch(CLEARED_TEAM_FILTERS)}
    />
  );
}
