import { useState, type ReactNode } from "react";

import { cx } from "../kit/index";
import {
  DEFAULT_LAYOUT,
  LIMITS,
  resizeColumn,
  resizeSplit,
  toggleColumn,
  toggleGroup,
  type FittedColumn,
  type Side,
  type Viewport,
} from "../layout/model";
import type { LayoutState } from "../layout/use-layout";
import type { PanelContext, PanelDef } from "../panels/registry";
import { PanelGroup } from "./PanelGroup";
import { SplitHandle } from "./SplitHandle";

/** The panels a column draws in its tab groups. */
export type ColumnPanels = {
  defs: readonly PanelDef[];
  ctx: PanelContext;
  booting?: boolean;
};

export type ColumnProps = {
  side: Side;
  /** Where `fitLayout` draws this column; never a rail. */
  fitted: FittedColumn;
  layout: LayoutState;
  viewport: Viewport;
  /** Tab groups from the layout; without them the column holds `children`. */
  panels?: ColumnPanels;
  children?: ReactNode;
};

const SIDE_NAME: Record<Side, string> = { left: "Left", right: "Right" };

/** The class that finds a group by its place, for focusing it. */
export const groupClass = (side: Side, index: 0 | 1) => `je-frame-group-${side}-${index}`;

/**
 * One open column at its fitted place and size: its tab groups (or the slot
 * it was given) with the split between them, and its inner edge as a
 * handle. Drags preview here and reach the layout once, on release.
 */
export function Column({ side, fitted, layout, viewport, panels, children }: ColumnProps) {
  const [width, setWidth] = useState<number | null>(null);
  const [split, setSplit] = useState<number | null>(null);
  const { update } = layout;

  const drawnWidth = width ?? fitted.width;
  const x = side === "left" ? fitted.x : fitted.x + fitted.width - drawnWidth;
  const groups = fitted.groups;
  const [top, bottom] = groups;
  const gap = top && bottom ? bottom.y - top.height : 0;
  const bottomHeight = bottom ? (split ?? bottom.height) : 0;
  const placed =
    top && bottom && split !== null
      ? [
          { ...top, height: fitted.height - gap - bottomHeight },
          { ...bottom, y: fitted.height - bottomHeight, height: bottomHeight, collapsed: false },
        ]
      : groups;
  const name = SIDE_NAME[side];

  return (
    <div
      className={cx("je-frame-column", `je-frame-${side}`)}
      data-side={side}
      style={{ left: x, top: fitted.y, width: drawnWidth, height: fitted.height }}
    >
      {panels ? (
        placed.map((g, i) => (
          <PanelGroup
            key={i}
            side={side}
            index={i === 0 ? 0 : 1}
            layout={layout}
            viewport={viewport}
            ctx={panels.ctx}
            panels={panels.defs}
            booting={panels.booting}
            className={cx("je-frame-group", groupClass(side, i === 0 ? 0 : 1))}
            style={{ top: g.y, height: g.height }}
          />
        ))
      ) : (
        <div className="je-frame-column-body">{children}</div>
      )}
      {panels && top && bottom ? (
        <SplitHandle
          orientation="horizontal"
          label={`${name} column split`}
          className="je-split-groups"
          style={{ top: placed[1]!.y - gap, height: gap }}
          value={bottomHeight}
          min={LIMITS.group.min}
          max={fitted.height - gap - LIMITS.group.min}
          grow={-1}
          onPreview={setSplit}
          onChange={(h) =>
            update((l) => {
              const next = resizeSplit(l, side, h);
              return next[side].groups[1]?.collapsed ? toggleGroup(next, side, 1) : next;
            })
          }
          onToggle={() => update((l) => toggleGroup(l, side, 1))}
          onReset={() =>
            update((l) => resizeSplit(l, side, DEFAULT_LAYOUT[side].groups[1]?.size ?? 240))
          }
        />
      ) : null}
      <SplitHandle
        orientation="vertical"
        label={`${name} column edge`}
        className="je-split-edge"
        value={drawnWidth}
        min={LIMITS.column.min}
        max={LIMITS.column.max}
        grow={side === "left" ? 1 : -1}
        onPreview={setWidth}
        onChange={(w) => update((l) => resizeColumn(l, side, w))}
        onToggle={() => update((l) => toggleColumn(l, side, viewport))}
        onReset={() => update((l) => resizeColumn(l, side, DEFAULT_LAYOUT[side].width))}
      />
    </div>
  );
}
