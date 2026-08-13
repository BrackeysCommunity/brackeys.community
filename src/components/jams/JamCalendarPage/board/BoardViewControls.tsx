import {
  GridViewIcon,
  LeftToRightListBulletIcon,
  SortByDown02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { BoardLayout, BoardSort } from "./build-board";

const SORT_LABELS: Record<BoardSort, string> = {
  signal: "BIGGEST",
  soonest: "SOONEST",
};

/**
 * The board's two display controls, sized to sit inline beside the
 * search field: sort as an icon-triggered popover (the labels are long
 * and only matter at the moment of choosing) and layout as a single
 * icon button showing the mode it will switch *to*.
 *
 * Hover hints use native `title` rather than `SimpleTooltip` — that
 * component renders its own `<button>` trigger, which would nest a
 * button inside these buttons.
 */
export function BoardViewControls({
  sort,
  onSortChange,
  layout,
  onLayoutChange,
}: {
  sort: BoardSort;
  onSortChange: (s: BoardSort) => void;
  layout: BoardLayout;
  onLayoutChange: (l: BoardLayout) => void;
}) {
  const nextLayout: BoardLayout = layout === "cards" ? "list" : "cards";
  const nextLayoutLabel = nextLayout === "list" ? "list" : "card";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-lg"
              className="size-10"
              title={`Sort: ${SORT_LABELS[sort]}`}
              aria-label={`Sort order: ${SORT_LABELS[sort]}`}
            />
          }
        >
          <HugeiconsIcon icon={SortByDown02Icon} size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSortChange(v as BoardSort)}>
            <DropdownMenuRadioItem value="signal">BIGGEST</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="soonest">SOONEST</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="icon-lg"
        className="size-10"
        onClick={() => onLayoutChange(nextLayout)}
        title={`Switch to ${nextLayoutLabel} view`}
        aria-label={`Switch to ${nextLayoutLabel} view`}
      >
        <HugeiconsIcon
          icon={nextLayout === "list" ? LeftToRightListBulletIcon : GridViewIcon}
          size={16}
        />
      </Button>
    </div>
  );
}
