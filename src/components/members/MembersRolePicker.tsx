import { useQuery } from "@tanstack/react-query";

import { FacetPicker } from "@/components/ui/facet-picker";
import { client, orpc } from "@/orpc/client";

import { memberFacetInput, type MembersSearch, type SetMembersSearch } from "./members-filters";

/**
 * The directory's role filter — "find me a composer", answered from the
 * same `collab_roles` vocabulary the board hires against. Counts follow
 * the {@link FacetPicker} contract: every filter except the role facet
 * itself applies, so each number reads "how many members ticking this
 * would turn up".
 */
export function MembersRolePicker({
  search,
  setSearch,
  inline,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  inline?: boolean;
}) {
  const selected = search.roles ?? [];
  const { roleIds: _roleIds, ...facets } = memberFacetInput(search);

  const { data } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useQuery({
    queryKey: ["memberRoleCounts", facets],
    queryFn: () => client.countMembersByRole(facets),
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });

  const roles = data ?? [];
  if (roles.length === 0) return null;

  return (
    <FacetPicker
      label="ROLE"
      options={roles}
      selectedIds={selected}
      onChange={(next) => setSearch({ roles: next.length > 0 ? next : undefined })}
      counts={counts}
      searchPlaceholder="Search roles…"
      hint="Shows members claiming any of these."
      inline={inline}
    />
  );
}
