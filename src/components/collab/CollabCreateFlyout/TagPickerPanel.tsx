import {
  ArrowDown01Icon,
  Cancel01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Input } from "@/components/ui/input";
import { usePortalContainer } from "@/components/ui/portal-container";
import { Text } from "@/components/ui/typography";
import { isSubmitKey } from "@/lib/keyboard";
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

/** Roughly one category header plus a few rows — below this, open upward. */
const MIN_POPUP_HEIGHT = 180;
const MAX_POPUP_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

interface PopupPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where a body-portaled popup sits relative to its field. Viewport
 * coordinates, recomputed on scroll and resize, so an ancestor that
 * scrolls (the create modal's body) carries the list with it.
 */
function usePopupPosition(
  anchor: HTMLElement | null,
  open: boolean,
): { position: PopupPosition | null; measure: () => void } {
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const measure = useCallback(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const above = rect.top - VIEWPORT_MARGIN;
    const flip = below < MIN_POPUP_HEIGHT && above > below;
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      maxHeight: Math.min(MAX_POPUP_HEIGHT, Math.max(flip ? above : below, MIN_POPUP_HEIGHT)),
    });
  }, [anchor]);

  // The first measurement belongs to whatever opened the list, so this
  // only keeps it honest afterwards. Capture phase: the scroller is an
  // ancestor (the modal body), and a scroll there doesn't bubble.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  return { position: open ? position : null, measure };
}

/**
 * Shared picker for the wizard's two controlled vocabularies — roles and
 * tech stack. Focusing the field opens the whole vocabulary grouped by
 * category, each group collapsed to its header; typing filters it and
 * opens every group that still matches. Picking one drops a chip below
 * the box.
 *
 * The list keeps showing entries that are already picked, ticked, so it
 * doubles as the answer to "did I already add this?" and lets you take
 * one back off without hunting for its chip. The browsable catalogue is
 * the answer to "what if I don't know exactly who I'm looking for" —
 * showing every entry *flat* is what buried the handful a post wants, so
 * the category headers are what a cold start sees.
 *
 * Portaled to <body> and positioned against the field, except inside a
 * focus-trapping drawer. A popup that stays in flow is clipped by
 * whatever ancestor scrolls — in the create modal that's a box sized to
 * two short fields, so the list opened into its own bottom edge with
 * two-thirds of the viewport empty underneath. The drawer keeps the
 * in-flow variant: vaul's `transform` makes `position: fixed` resolve
 * against the drawer's box rather than the viewport (see the comments in
 * `SelectContent`), and the drawer is tall enough that nothing clips.
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
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  // Roving highlight over the rows currently showing, so Enter has an
  // answer without a mouse: the first match by default, or whatever the
  // arrow keys moved it to.
  const [activeIndex, setActiveIndex] = useState(0);
  const query = search.trim().toLowerCase();

  const listId = useId();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const portalContainer = usePortalContainer();
  const { position, measure } = usePopupPosition(anchor, open && portalContainer === null);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const atCap = max !== undefined && selectedIds.length >= max;

  const groups = useMemo(() => {
    const matches = query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;
    const map = new Map<string, TagOption[]>();
    for (const option of matches) {
      const key = option.category ?? "Other";
      const bucket = map.get(key);
      if (bucket) bucket.push(option);
      else map.set(key, [option]);
    }
    return [...map.entries()];
  }, [options, query]);

  // Rows in render order — an entry counts only while its group is open.
  const visible = useMemo(
    () =>
      groups.flatMap(([category, items]) =>
        query.length > 0 || expanded.includes(category) ? items : [],
      ),
    [groups, query, expanded],
  );
  const activeOption = visible[Math.min(activeIndex, visible.length - 1)] ?? null;
  const optionDomId = (id: number) => `${listId}-option-${id}`;

  useEffect(() => {
    if (!open || !activeOption) return;
    const row = document.getElementById(`${listId}-option-${activeOption.id}`);
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [open, activeOption, listId]);

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else if (atCap) return;
    else onChange([...selectedIds, id]);
    // Clearing returns the list to the catalogue and leaves an empty box
    // ready for the next search — picking one entry is the end of that
    // query, and the chip below is the confirmation.
    setSearch("");
    setActiveIndex(0);
  };

  const moveActive = (delta: number) => {
    if (visible.length === 0) return;
    setActiveIndex((i) => {
      const from = Math.min(i, visible.length - 1);
      return (from + delta + visible.length) % visible.length;
    });
  };

  const openList = () => {
    // Measured here rather than in an effect so the list has somewhere to
    // be on the frame it first renders.
    measure();
    setOpen(true);
  };

  const list = (
    <div
      id={listId}
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeOption ? optionDomId(activeOption.id) : undefined}
      // The house popover surface (`SelectContent`, `ComboboxContent`), and
      // `no-scrollbar` for the same reason those use it: the clipped row at
      // the edge is the affordance, and a bar drawn inside a floating panel
      // this small reads as chrome on chrome.
      // The padding is load-bearing, not decoration: the cursor's corner
      // frame draws 6px outside whatever it latches onto, so a row flush to
      // the panel's edge puts its left and right brackets straight onto the
      // panel's own 1px border — and, near the top, across its rounded
      // corner. `p-3` lands them on flat surface instead.
      className="chonk-emboss-panel no-scrollbar overflow-y-auto rounded-lg bg-popover p-3 text-popover-foreground"
      style={{ maxHeight: position ? position.maxHeight : MAX_POPUP_HEIGHT }}
      // Keeps focus in the input, so the list can't blur out from under a
      // click and typing continues straight after a pick.
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.length === 0 ? (
        <Text as="div" size="xs" variant="muted" className="px-2.5 py-1">
          {emptyMessage}
        </Text>
      ) : groups.length === 0 ? (
        <Text as="div" size="xs" variant="muted" className="px-2.5 py-1">
          Nothing matches that search.
        </Text>
      ) : (
        groups.map(([category, items]) => {
          // A search has already narrowed things down; making the matches
          // take a second click would be the old problem again.
          const isOpen = query.length > 0 || expanded.includes(category);
          return (
            <div key={category} role="group" aria-label={category}>
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) =>
                    prev.includes(category)
                      ? prev.filter((c) => c !== category)
                      : [...prev, category],
                  )
                }
                aria-expanded={isOpen}
                disabled={query.length > 0}
                className="flex w-full items-center justify-between gap-2 px-2.5 pt-2 pb-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
              >
                <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
                  {category}
                </Text>
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <Text as="span" size="xs" variant="muted">
                    {items.length}
                  </Text>
                  {query.length === 0 ? (
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={12}
                      className={cn("transition-transform", isOpen && "rotate-180")}
                    />
                  ) : null}
                </span>
              </button>
              {isOpen ? (
                <div className="flex flex-col gap-1 pb-1.5">
                  {items.map((option) => {
                    const selected = selectedIds.includes(option.id);
                    const active = activeOption?.id === option.id;
                    return (
                      <Chonk
                        key={option.id}
                        variant="surface"
                        size="sm"
                        render={
                          <button
                            type="button"
                            id={optionDomId(option.id)}
                            role="option"
                            aria-selected={selected}
                            data-active={active || undefined}
                            onClick={() => toggle(option.id)}
                            disabled={!selected && atCap}
                          />
                        }
                        className={cn(
                          "w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs",
                          "disabled:cursor-not-allowed disabled:opacity-40",
                          "data-active:ring-1 data-active:ring-ring",
                          selected && "text-primary",
                        )}
                      >
                        {option.name}
                        {selected ? <HugeiconsIcon icon={Tick02Icon} size={12} /> : null}
                      </Chonk>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <FieldRow label={label} hint={hint} action={action}>
      <div className="relative" ref={setAnchor}>
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setSearch(e.target.value);
            setActiveIndex(0);
            openList();
          }}
          onFocus={openList}
          // Reopens after an Escape, which leaves focus where it is.
          onClick={openList}
          // Nothing in the list takes focus — the popup cancels its own
          // mousedown — so a blur means the user has genuinely left.
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) openList();
              else moveActive(e.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (isSubmitKey(e)) {
              // A bare Enter takes the highlighted row — the first match
              // unless the arrows moved it — and never submits the form
              // around the picker.
              e.preventDefault();
              if (open && activeOption) toggle(activeOption.id);
              return;
            }
            if (e.key !== "Escape" || !open) return;
            // The picker eats its own Escape: the first press closes the
            // list, and only a second one reaches the dialog around it.
            e.stopPropagation();
            setSearch("");
            setOpen(false);
          }}
          placeholder={searchPlaceholder}
          className="pl-8"
        />

        {open && portalContainer !== null ? (
          <div className="absolute top-full right-0 left-0 z-20 mt-1">{list}</div>
        ) : null}
      </div>

      {open && portalContainer === null && position
        ? createPortal(
            <div
              className="fixed z-50"
              style={{
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom,
              }}
            >
              {list}
            </div>,
            document.body,
          )
        : null}

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
