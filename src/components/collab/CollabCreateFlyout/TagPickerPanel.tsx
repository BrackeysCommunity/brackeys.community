import { Cancel01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { FieldRow } from "./fields";

/** One entry in a controlled vocabulary — roles and skills both fit. */
export interface TagOption {
  id: number;
  name: string;
  category?: string | null;
}

interface TagPickerPanelProps {
  label: string;
  hint?: string;
  action?: ReactNode;
  options: TagOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  searchPlaceholder: string;
  /** Shown when the vocabulary itself is empty or still loading. */
  emptyMessage: string;
  /** Optional selection cap. */
  max?: number;
  atCapMessage?: string;
}

/**
 * Shared picker for the wizard's two controlled vocabularies — roles and
 * tech stack. Typing opens a plain list of matches over the field;
 * picking one drops a chip below the box.
 *
 * The list keeps showing entries that are already picked, ticked, so it
 * doubles as the answer to "did I already add this?" and lets you take
 * one back off without hunting for its chip. Nothing renders until
 * there's a query: the vocabularies run to dozens of entries each, and
 * showing them all at once buried the handful a post actually wants.
 *
 * Positioned, not portaled. A portaled popup inside the create flyout
 * has to fight both vaul's focus trap and its `transform` (see the
 * comments in `SelectContent`), and none of that is worth it for a list
 * that only ever needs to sit directly under its own input.
 */
export function TagPickerPanel({
  label,
  hint,
  action,
  options,
  selectedIds,
  onChange,
  searchPlaceholder,
  emptyMessage,
  max,
  atCapMessage,
}: TagPickerPanelProps) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const atCap = max !== undefined && selectedIds.length >= max;

  const groups = useMemo(() => {
    if (!query) return [];
    const matches = options.filter((o) => o.name.toLowerCase().includes(query));
    const map = new Map<string, TagOption[]>();
    for (const option of matches) {
      const key = option.category ?? "Other";
      const bucket = map.get(key);
      if (bucket) bucket.push(option);
      else map.set(key, [option]);
    }
    return [...map.entries()];
  }, [options, query]);

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else if (atCap) return;
    else onChange([...selectedIds, id]);
    // Clearing closes the list and leaves an empty box ready for the next
    // search — picking one entry is the end of that query, and the chip
    // below is the confirmation, so there's nothing left to look at.
    setSearch("");
  };

  return (
    <FieldRow label={label} hint={hint} action={action}>
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
          }}
          placeholder={searchPlaceholder}
          className="pl-8"
        />

        {query ? (
          <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded border border-muted/40 bg-popover shadow-md">
            {options.length === 0 ? (
              <Text as="div" size="xs" variant="muted" className="px-2.5 py-2">
                {emptyMessage}
              </Text>
            ) : groups.length === 0 ? (
              <Text as="div" size="xs" variant="muted" className="px-2.5 py-2">
                Nothing matches that search.
              </Text>
            ) : (
              groups.map(([category, items]) => (
                <div key={category}>
                  <Text
                    as="div"
                    size="xs"
                    variant="muted"
                    className="px-2.5 pt-2 pb-1 tracking-widest uppercase"
                  >
                    {category}
                  </Text>
                  {items.map((option) => {
                    const selected = selectedIds.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        // Keeps focus in the input, so the list can't blur
                        // out from under the click and typing continues
                        // straight after a pick.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggle(option.id)}
                        disabled={!selected && atCap}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs",
                          "transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40",
                          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
                          selected && "text-primary",
                        )}
                      >
                        {option.name}
                        {selected ? <HugeiconsIcon icon={Tick02Icon} size={12} /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange(selectedIds.filter((x) => x !== id))}
              aria-label={`Remove ${byId.get(id)?.name ?? "selection"}`}
              className="border-primary/50 tracking-widest text-primary"
            >
              {byId.get(id)?.name ?? `#${id}`}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Button>
          ))}
        </div>
      ) : null}

      {atCap && atCapMessage ? (
        <Text size="xs" variant="muted">
          {atCapMessage}
        </Text>
      ) : null}
    </FieldRow>
  );
}
