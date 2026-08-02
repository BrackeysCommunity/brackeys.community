import type { ReactNode } from "react";

import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/typography";

interface JamCalendarToolbarProps {
  search: string;
  onSearchChange: (q: string) => void;
  /** Right-aligned tally under the field, e.g. "412/487 JAMS". Omitted
   * for views that report their own totals (the archive table). */
  counter?: string;
  placeholder: string;
  /** View-specific controls rendered inline on the field's trailing
   * edge — the board's sort and layout buttons. */
  actions?: ReactNode;
}

/**
 * The filter rail for the active view: a search field with an optional
 * slot for that view's display controls. The old chip toggles and range
 * switches died with the event-timeline — phase and signal are encoded
 * by the board's shelves and the calendar's bars now.
 */
export function JamCalendarToolbar({
  search,
  onSearchChange,
  counter,
  placeholder,
  actions,
}: JamCalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder={placeholder}
          autoComplete="off"
          size="default"
          containerClassName="h-10 min-w-64 flex-1"
          className="text-[11px] tracking-widest"
        />
        {actions}
      </div>
      {counter && (
        <Text size="xs" variant="muted" align="right" className="tracking-widest tabular-nums">
          {counter}
        </Text>
      )}
    </div>
  );
}
