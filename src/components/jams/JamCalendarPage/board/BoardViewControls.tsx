import { GridViewIcon, LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { SortMenu } from "@/components/ui/filter-menu";

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
      <SortMenu
        size="lg"
        className="size-10"
        contentClassName="w-40"
        options={(Object.keys(SORT_LABELS) as BoardSort[]).map((value) => ({
          value,
          label: SORT_LABELS[value],
        }))}
        value={sort}
        onChange={(v) => onSortChange(v as BoardSort)}
      />

      <Button
        variant="outline"
        size="icon-lg"
        className="size-10"
        onClick={() => onLayoutChange(nextLayout)}
        tooltip={`Switch to ${nextLayoutLabel} view`}
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
