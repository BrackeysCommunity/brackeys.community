import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { CLEARED_COLLAB_FILTERS, useCollabBoardSearch } from "./collab-filters";
import { useCollabResultCount } from "./use-collab-counts";

// Legacy playtest/mentor rows can still be on the board even though the
// types are no longer offered, so their labels stay.
const TYPE_LABELS: Record<string, string> = {
  paid: "PAID WORK",
  hobby: "HOBBY",
  playtest: "PLAYTEST",
  mentor: "MENTOR",
};
const STATUS_LABELS: Record<string, string> = {
  recruiting: "OPEN",
  party_full: "CLOSED",
};
const EXPERIENCE_LABELS: Record<string, string> = {
  beginner: "BEGINNER",
  intermediate: "INTERMEDIATE",
  experienced: "EXPERIENCED",
};
/** Facet picks that still read as individual chips rather than a tally. */
const VISIBLE_FACET_CHIPS = 3;

const COMP_LABELS: Record<string, string> = {
  hourly: "HOURLY",
  fixed: "FIXED",
  rev_share: "REV SHARE",
  negotiable: "NEGOTIABLE",
};

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
    staleTime: 5 * 60 * 1000,
  });
  const { data: roleData } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    enabled: roleIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const { data: skillData } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    enabled: skillIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const { data: teamData } = useQuery({
    ...orpc.getTeam.queryOptions({ input: { teamId: search.team ?? "" } }),
    enabled: search.team !== undefined,
    staleTime: 5 * 60 * 1000,
  });
  const { data: projectData } = useQuery({
    ...orpc.getProject.queryOptions({ input: { idOrSlug: search.project ?? "" } }),
    enabled: search.project !== undefined,
    staleTime: 5 * 60 * 1000,
  });

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (search.type) {
    chips.push({
      key: "type",
      label: TYPE_LABELS[search.type] ?? search.type,
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
      label: EXPERIENCE_LABELS[search.level] ?? search.level,
      clear: () => setSearch({ level: undefined }),
    });
  }
  if (search.comp) {
    chips.push({
      key: "comp",
      label: COMP_LABELS[search.comp] ?? search.comp,
      clear: () => setSearch({ comp: undefined }),
    });
  }
  if (search.solo !== undefined) {
    chips.push({
      key: "solo",
      label: search.solo ? "SOLO DEVS" : "TEAMS",
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

  // Filtered boards count matches; an unfiltered board counts what it holds.
  const label =
    chips.length > 0 ? (count === 1 ? "MATCH" : "MATCHES") : count === 1 ? "POST" : "POSTS";

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
          {/* Only with two or more skills picked — the two modes can't
              disagree on fewer. */}
          {skillIds.length > 1 ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setSearch({ matchAll: search.matchAll ? undefined : true })}
              aria-pressed={!!search.matchAll}
              aria-label="Require every selected skill instead of any"
              className={cn(
                "tracking-widest",
                search.matchAll ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              MATCH ALL
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSearch(CLEARED_COLLAB_FILTERS)}
            className="tracking-widest text-muted-foreground"
          >
            CLEAR ALL
          </Button>
        </div>
      ) : null}
    </div>
  );
}
