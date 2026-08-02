import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { collabStore, resetCollabFilters, setCollabFilters } from "@/lib/collab-store";

import { useCollabResultCount } from "./use-collab-counts";

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
  const filters = useStore(collabStore, (s) => s.filters);
  const count = useCollabResultCount();
  const isPeople = filters.listingType === "people";

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.type) {
    chips.push({
      key: "type",
      label: TYPE_LABELS[filters.type] ?? filters.type,
      clear: () => setCollabFilters({ type: undefined }),
    });
  }
  if (filters.status) {
    chips.push({
      key: "status",
      label: STATUS_LABELS[filters.status] ?? filters.status,
      clear: () => setCollabFilters({ status: undefined }),
    });
  }
  if (filters.experienceLevel && filters.experienceLevel !== "any") {
    chips.push({
      key: "level",
      label: EXPERIENCE_LABELS[filters.experienceLevel] ?? filters.experienceLevel,
      clear: () => setCollabFilters({ experienceLevel: undefined }),
    });
  }
  if (filters.compensationType) {
    chips.push({
      key: "comp",
      label: COMP_LABELS[filters.compensationType] ?? filters.compensationType,
      clear: () => setCollabFilters({ compensationType: undefined }),
    });
  }
  if (filters.search) {
    chips.push({
      key: "search",
      label: `“${filters.search}”`,
      clear: () => setCollabFilters({ search: "" }),
    });
  }

  // Filtered boards count matches; an unfiltered board counts what it holds.
  const noun = isPeople ? "DEV" : "POST";
  const label =
    chips.length > 0 ? (count === 1 ? "MATCH" : "MATCHES") : count === 1 ? noun : `${noun}S`;

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
            onClick={resetCollabFilters}
            className="tracking-widest text-muted-foreground"
          >
            CLEAR ALL
          </Button>
        </div>
      ) : null}
    </div>
  );
}
