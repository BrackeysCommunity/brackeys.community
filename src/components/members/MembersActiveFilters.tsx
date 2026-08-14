import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { orpc } from "@/orpc/client";

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
  const { data: skillData } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    enabled: skillIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const { data: roleData } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    enabled: roleIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const chips: { key: string; label: string; clear: () => void }[] = [];
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

  // A filtered directory counts matches; an unfiltered one counts what it holds.
  const label =
    chips.length > 0 ? (count === 1 ? "MATCH" : "MATCHES") : count === 1 ? "MEMBER" : "MEMBERS";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-dashed border-muted-foreground/25 pb-3">
      <div className="flex items-baseline gap-2">
        <Text as="span" bold density="dense" className="text-2xl text-foreground tabular-nums">
          {count ?? "—"}
        </Text>
        <Text as="span" size="xs" variant="muted" className="tracking-widest">
          {label}
        </Text>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="outline"
              size="xs"
              onClick={chip.clear}
              aria-label={`Remove filter ${chip.label}`}
              className="border-primary/50 tracking-widest text-primary uppercase"
            >
              {chip.label}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSearch(CLEARED_MEMBER_FILTERS)}
            className="tracking-widest text-muted-foreground"
          >
            CLEAR ALL
          </Button>
        </div>
      ) : null}
    </div>
  );
}
