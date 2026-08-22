import { ActiveFilterBar, type ActiveFilterChip } from "@/components/common/ActiveFilterBar";
import { useRolesCatalog, useSkillsCatalog } from "@/lib/hooks/use-taxonomy";

import {
  availabilityLabel,
  CLEARED_MEMBER_FILTERS,
  type MembersSearch,
  type SetMembersSearch,
} from "./members-filters";

/**
 * The directory's live count plus one removable chip per active filter,
 * mirroring the team directory's readout. It carries the count because
 * the toolbar can't: on touch the toolbar is search alone and the
 * controls float by the thumb, so this is the only place the result of
 * filtering is stated — and the only place a single constraint can be
 * undone without reopening the drawer.
 */
export function MembersActiveFilters({
  search,
  setSearch,
  count,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  /** `null` while the listing is still loading. */
  count: number | null;
}) {
  const skillIds = search.skills ?? [];
  const roleIds = search.roles ?? [];
  const availability = search.availability ?? [];

  // Only fetched to name the ids the chips carry — already cached by the
  // pickers that set the filter.
  const { data: skillData } = useSkillsCatalog({ enabled: skillIds.length > 0 });
  const { data: roleData } = useRolesCatalog({ enabled: roleIds.length > 0 });

  const chips: ActiveFilterChip[] = [];
  if (search.open) {
    chips.push({
      key: "open",
      label: "OPEN TO WORK",
      clear: () => setSearch({ open: undefined }),
    });
  }
  for (const value of availability) {
    chips.push({
      key: `availability-${value}`,
      label: availabilityLabel(value) ?? value,
      clear: () => setSearch({ availability: availability.filter((v) => v !== value) }),
    });
  }
  if (search.rate != null) {
    chips.push({
      key: "rate",
      label: `UNDER $${search.rate}/HR`,
      clear: () => setSearch({ rate: undefined }),
    });
  }
  if (search.tz != null) {
    chips.push({
      key: "tz",
      label: `WITHIN ±${search.tz}H`,
      clear: () => setSearch({ tz: undefined }),
    });
  }
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
      noun={["MEMBER", "MEMBERS"]}
      chips={chips}
      onClearAll={() => setSearch(CLEARED_MEMBER_FILTERS)}
      matchAll={
        skillIds.length > 1
          ? {
              pressed: !!search.matchAll,
              toggle: () => setSearch({ matchAll: search.matchAll ? undefined : true }),
            }
          : undefined
      }
      chipClassName="uppercase"
    />
  );
}
