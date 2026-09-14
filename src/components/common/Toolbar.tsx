import type * as React from "react";

import { BOTTOM_NAV_HEIGHT } from "@/components/layout/MobileShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  /** Line 1, full width. Omitted where the search box lives somewhere else. */
  search?: React.ReactNode;
  /** Line 2, leading edge: the facets. */
  children?: React.ReactNode;
  /** Line 2, trailing edge: sort, layout, reset — whatever shapes the view
   *  rather than the query. */
  controls?: React.ReactNode;
  /** Narrow layouts hand the facets to a sheet, so the row shows this
   *  button in their place. */
  onOpenFilters?: () => void;
  className?: string;
}

/**
 * The control surface every browse listing wears: search on top,
 * everything that shapes the listing below — facets from the leading
 * edge, display controls pinned to the trailing one. Sharing the frame is
 * what makes the boards feel like one product rather than five pages that
 * each invented a filter row.
 *
 * The match count is deliberately not here: it's a readout of the result,
 * and lives with the chips in {@link ActiveFilterBar} where it can scroll
 * away.
 */
export function Toolbar({ search, children, controls, onOpenFilters, className }: ToolbarProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {search}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenFilters ? (
          <Button variant="outline" size="sm" onClick={onOpenFilters} className="tracking-widest">
            FILTERS
          </Button>
        ) : (
          children
        )}
        {controls ? <div className="ml-auto flex items-center gap-2">{controls}</div> : null}
      </div>
    </div>
  );
}

/**
 * The touch layout's control row: FILTERS on the leading edge, the same
 * display controls on the trailing one, floating just above the bottom nav
 * island.
 *
 * Down here rather than in the toolbar because on a phone the toolbar is
 * three quarters of the way from the thumb, and these are what you reach
 * for repeatedly while scanning a listing. Split to the two edges so
 * neither thumb has to cross the screen, with the middle left open so the
 * listing stays readable behind them.
 */
export function ToolbarFloatingControls({
  onOpenFilters,
  children,
}: {
  onOpenFilters: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex items-center justify-between px-4"
      style={{
        bottom: `calc(${BOTTOM_NAV_HEIGHT} - 0.5rem)`,
        paddingLeft: "calc(1rem + env(safe-area-inset-left))",
        paddingRight: "calc(1rem + env(safe-area-inset-right))",
      }}
    >
      <Button
        variant="outline"
        size="lg"
        onClick={onOpenFilters}
        className="pointer-events-auto tracking-widest"
      >
        FILTERS
      </Button>
      <div className="pointer-events-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
