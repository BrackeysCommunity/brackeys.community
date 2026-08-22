import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * Shared look for the filter row's toggles. The depressed-while-on state
 * comes from `.chonk-emboss[aria-pressed="true"]` in the stylesheet — the
 * classes here only carry the color, and are `!` so they beat the outline
 * variant's own hover background rather than depending on rule order.
 *
 * The on-fill is mixed into the button surface rather than laid over it as
 * `primary/15`: an alpha fill replaces the variant's opaque background, and
 * the cards scrolling under the sticky toolbar show through the toggle.
 */
export const FILTER_TOGGLE =
  "tracking-widest uppercase aria-pressed:border-primary! aria-pressed:bg-[color-mix(in_oklab,var(--primary)_15%,var(--emboss-surface))]! aria-pressed:text-primary aria-pressed:[--emboss-shadow:var(--primary)]";

export interface ActiveFilterChip {
  key: string;
  label: string;
  clear: () => void;
}

/**
 * The listing's live count plus one removable chip per active filter — the
 * shared readout under the collab board and the members/teams directories.
 * It carries the count because the toolbar can't: on touch the toolbar is
 * search alone and the controls float by the thumb, so this is the only
 * place the result of filtering is stated — and the only place a single
 * constraint can be undone without reopening the drawer/rail.
 *
 * Each surface builds its own `chips` (that's where the filter vocabulary
 * lives); this owns the layout, the MATCH/MATCHES line, and the
 * MATCH ALL / CLEAR ALL controls.
 */
export function ActiveFilterBar({
  count,
  noun,
  chips,
  onClearAll,
  matchAll,
  chipClassName,
}: {
  /** `null` while the listing is still loading. */
  count: number | null;
  /** What an unfiltered listing counts, e.g. `["POST", "POSTS"]`. */
  noun: [singular: string, plural: string];
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  /**
   * The any-vs-every skills toggle. Pass only when two or more skills are
   * picked — the two modes can't disagree on fewer.
   */
  matchAll?: { pressed: boolean; toggle: () => void };
  chipClassName?: string;
}) {
  // A filtered listing counts matches; an unfiltered one counts what it holds.
  const label =
    chips.length > 0 ? (count === 1 ? "MATCH" : "MATCHES") : count === 1 ? noun[0] : noun[1];

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
              className={cn("border-primary/50 tracking-widest text-primary", chipClassName)}
            >
              {chip.label}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Button>
          ))}
          {matchAll ? (
            <Button
              variant="outline"
              size="xs"
              onClick={matchAll.toggle}
              aria-pressed={matchAll.pressed}
              aria-label="Require every selected skill instead of any"
              className={cn(
                "tracking-widest",
                matchAll.pressed ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              MATCH ALL
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            onClick={onClearAll}
            className="tracking-widest text-muted-foreground"
          >
            CLEAR ALL
          </Button>
        </div>
      ) : null}
    </div>
  );
}
