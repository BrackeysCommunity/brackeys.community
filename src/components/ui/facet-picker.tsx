import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MicroLabel, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** One entry in a controlled vocabulary the board can be filtered by. */
export interface FacetOption {
  id: number;
  name: string;
  category?: string | null;
}

/** Entries with no category of their own, kept last — a leftovers bin. */
const UNCATEGORISED = "Other";

interface FacetPickerProps {
  /** Trigger copy while nothing is picked, e.g. `STACK`. */
  label: string;
  options: FacetOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /**
   * Option id → how many results picking it would turn up under the
   * *other* filters in force. Drives ordering and the zero split; omit it
   * and the picker degrades to a searchable, grouped list.
   */
  counts?: Record<number, number>;
  searchPlaceholder?: string;
  /** One line under the list — the place to state how selections combine. */
  hint?: string;
  emptyMessage?: string;
  /** Renders the list open in place, for the mobile filter sheets. */
  inline?: boolean;
  className?: string;
}

/**
 * Multi-select over a vocabulary too long to enumerate — the tech stack
 * runs to ~80 entries across eight categories and members can request
 * more, so the old flat checkbox menu was a scroll with no way in.
 *
 * Three things do the work. Search, because typing two letters beats
 * hunting eighty rows. Category headings, because `skill.category` was
 * already populated and "which engine" is a different question from
 * "which language". And counts: entries the current board actually has
 * lead, sorted by weight, while the rest collapse behind a toggle. That
 * last one is what stops someone assembling a nine-entry filter that
 * matches nothing — a zero is visible before it's picked, not after.
 *
 * Zero-count entries stay selectable rather than disabled. They're valid
 * standing queries; the board just has nothing in them today.
 */
export function FacetPicker({
  label,
  options,
  selectedIds,
  onChange,
  counts,
  searchPlaceholder = "Search…",
  hint,
  emptyMessage = "Nothing to filter by yet.",
  inline,
  className,
}: FacetPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showEmpties, setShowEmpties] = useState(false);
  const query = search.trim().toLowerCase();

  const countOf = (id: number) => counts?.[id] ?? 0;
  const toggle = (id: number) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  // A search reaches the whole vocabulary regardless of the toggle —
  // typing a name is an explicit request for that entry, and answering
  // "no matches" when the entry exists is a lie.
  const { groups, hiddenCount } = useMemo(() => {
    const countOf = (id: number) => counts?.[id] ?? 0;
    const visible = options.filter((option) => {
      if (query) return option.name.toLowerCase().includes(query);
      if (selectedIds.includes(option.id)) return true;
      return showEmpties || !counts || countOf(option.id) > 0;
    });

    const byCategory = new Map<string, FacetOption[]>();
    for (const option of visible) {
      const key = option.category ?? UNCATEGORISED;
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(option);
      else byCategory.set(key, [option]);
    }

    // Heaviest category first, so the board's own centre of gravity is
    // what you land on. Alphabetical is the tiebreak, and without counts
    // it's the whole ordering.
    const weight = (items: FacetOption[]) => items.reduce((sum, o) => sum + countOf(o.id), 0);
    const entries = [...byCategory.entries()]
      .map(([category, items]) => ({
        category,
        items: [...items].sort(
          (a, b) => countOf(b.id) - countOf(a.id) || a.name.localeCompare(b.name),
        ),
      }))
      .sort((a, b) => {
        if (a.category === UNCATEGORISED) return 1;
        if (b.category === UNCATEGORISED) return -1;
        return weight(b.items) - weight(a.items) || a.category.localeCompare(b.category);
      });

    const hidden = query
      ? 0
      : options.filter((o) => countOf(o.id) === 0 && !selectedIds.includes(o.id)).length;

    return { groups: entries, hiddenCount: counts && !showEmpties ? hidden : 0 };
  }, [options, query, selectedIds, counts, showEmpties]);

  const list = (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={searchPlaceholder}
        className="tracking-wide"
      />
      <CommandList className={cn(inline && "max-h-64")}>
        {options.length === 0 ? (
          <CommandEmpty>{emptyMessage}</CommandEmpty>
        ) : groups.length === 0 ? (
          // An unqueried list can still come up empty — every entry in the
          // vocabulary is at zero and therefore collapsed. Saying "nothing
          // matches that search" there blames a search nobody ran; the
          // toggle below is the way out, so point at it.
          <CommandEmpty>
            {query ? "Nothing matches that search." : "Nothing here has any yet."}
          </CommandEmpty>
        ) : (
          groups.map(({ category, items }) => (
            <CommandGroup key={category} heading={category}>
              {items.map((option) => {
                const checked = selectedIds.includes(option.id);
                const n = countOf(option.id);
                return (
                  <CommandItem
                    key={option.id}
                    value={String(option.id)}
                    data-checked={checked}
                    onSelect={() => toggle(option.id)}
                    className={cn("cursor-pointer", checked && "text-primary")}
                  >
                    {/* The name takes the slack so the count is a real
                        column. Leaving it to `ml-auto` splits the free space
                        with the tick's own `ml-auto`, which lands the number
                        at a different x for every name length. */}
                    <span
                      className={cn(
                        "flex-1 truncate",
                        counts && n === 0 && "text-muted-foreground",
                      )}
                    >
                      {option.name}
                    </span>
                    {counts ? (
                      <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
                        {n === 0 ? "—" : n}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))
        )}
      </CommandList>

      {/* The hint explains how the shortlist combines, which is worth a
          line while the list *is* a shortlist. Once the whole vocabulary
          is showing it's a footer with nothing above it to qualify, so it
          goes with the toggle that replaced it. */}
      {hiddenCount > 0 || (hint && !showEmpties) ? (
        <div className="flex flex-col gap-1 border-t border-border px-2 pt-2">
          {hiddenCount > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowEmpties(true)}
              className="justify-start tracking-widest text-muted-foreground"
            >
              {`SHOW ${hiddenCount} WITH NO MATCHES`}
            </Button>
          ) : null}
          {hint && !showEmpties ? (
            <Text as="p" size="xs" variant="muted" className="px-2 pb-1">
              {hint}
            </Text>
          ) : null}
        </div>
      ) : null}
    </Command>
  );

  if (inline) {
    return (
      <div className={cn("rounded-lg border border-border bg-background/40", className)}>
        {list}
      </div>
    );
  }

  const triggerLabel =
    selectedIds.length === 0
      ? label
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.name.toUpperCase() ?? label)
        : `${label} · ${selectedIds.length}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing ends the query, and the expansion that went with it —
        // reopening should land back on the shortlist rather than on
        // whatever the last visit left unfolded.
        if (!next) {
          setSearch("");
          setShowEmpties(false);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "tracking-widest",
              selectedIds.length > 0 && "border-primary text-primary",
              className,
            )}
          />
        }
      >
        {triggerLabel}
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <MicroLabel className="px-3 pt-2.5 pb-1 text-muted-foreground">{label}</MicroLabel>
        {list}
      </PopoverContent>
    </Popover>
  );
}
