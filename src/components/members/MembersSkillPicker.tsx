import { useQuery } from "@tanstack/react-query";

import { FacetPicker } from "@/components/ui/facet-picker";
import { client, orpc } from "@/orpc/client";

import { memberFacetInput, type MembersSearch, type SetMembersSearch } from "./members-filters";

/**
 * The directory's stack filter, shared by the toolbar and the mobile
 * drawer. Counts are computed with every filter *except* the stack, so
 * each number answers "how many members ticking this would turn up" —
 * see {@link FacetPicker}.
 */
export function MembersSkillPicker({
  search,
  setSearch,
  inline,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  inline?: boolean;
}) {
  const selected = search.skills ?? [];
  const { skillIds: _skillIds, ...facets } = memberFacetInput(search);

  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useQuery({
    queryKey: ["memberSkillCounts", facets],
    queryFn: () => client.countMembersBySkill(facets),
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });

  const skills = data ?? [];
  if (skills.length === 0) return null;

  return (
    <FacetPicker
      label="SKILLS"
      options={skills}
      selectedIds={selected}
      onChange={(next) => setSearch({ skills: next.length > 0 ? next : undefined })}
      counts={counts}
      searchPlaceholder="Search engines, languages, tools…"
      hint="Shows members with any of these."
      inline={inline}
    />
  );
}
