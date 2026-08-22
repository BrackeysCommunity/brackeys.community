import { useQuery } from "@tanstack/react-query";

import { FacetPicker } from "@/components/ui/facet-picker";
import { useSkillsCatalog } from "@/lib/hooks/use-taxonomy";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { type SetTeamsSearch, teamFacetInput, type TeamsSearch } from "./teams-filters";

/**
 * The directory's stack filter, shared by the toolbar and the mobile
 * drawer. A team's stack is derived from its roster, so a count here is
 * teams-with-someone-who-knows-it, not headcount — see
 * {@link FacetPicker} for the rest.
 */
export function TeamsSkillPicker({
  search,
  setSearch,
  inline,
}: {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
  inline?: boolean;
}) {
  const selected = search.skills ?? [];
  const { skillIds: _skillIds, ...facets } = teamFacetInput(search);

  const { data } = useSkillsCatalog();
  const { data: counts } = useQuery({
    queryKey: ["teamSkillCounts", facets],
    queryFn: () => client.countTeamsBySkill(facets),
    staleTime: STALE.viewer,
    placeholderData: (previous) => previous,
  });

  const skills = data ?? [];
  if (skills.length === 0) return null;

  return (
    <FacetPicker
      label="STACK"
      options={skills}
      selectedIds={selected}
      onChange={(next) => setSearch({ skills: next.length > 0 ? next : undefined })}
      counts={counts}
      searchPlaceholder="Search engines, languages, tools…"
      hint="Shows teams with any of these on the roster."
      inline={inline}
    />
  );
}
