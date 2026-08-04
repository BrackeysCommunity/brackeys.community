import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { orpc } from "@/orpc/client";

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
  const { data: skillData } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    enabled: skillIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const chips: { key: string; label: string; clear: () => void }[] = [];
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

  // A filtered directory counts matches; an unfiltered one counts what it holds.
  const label =
    chips.length > 0 ? (count === 1 ? "MATCH" : "MATCHES") : count === 1 ? "TEAM" : "TEAMS";

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
              className="border-primary/50 tracking-widest text-primary"
            >
              {chip.label}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSearch(CLEARED_TEAM_FILTERS)}
            className="tracking-widest text-muted-foreground"
          >
            CLEAR ALL
          </Button>
        </div>
      ) : null}
    </div>
  );
}
