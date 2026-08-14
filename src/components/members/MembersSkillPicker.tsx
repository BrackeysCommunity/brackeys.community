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
  const { skillIds, matchAll, ...facets } = memberFacetInput(search);
  // Any-of counts strip the stack so each number answers "how many would
  // ticking this add"; all-of picks narrow, so the stack stays in force
  // and the number answers "how many would remain".
  const countInput = matchAll ? { ...facets, skillIds, matchAll } : facets;

  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useQuery({
    queryKey: ["memberSkillCounts", countInput],
    queryFn: () => client.countMembersBySkill(countInput),
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
      hint={matchAll ? "Shows members with all of these." : "Shows members with any of these."}
      inline={inline}
    />
  );
}
