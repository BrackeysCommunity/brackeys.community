import { SidebarLeftIcon, SidebarRightIcon } from "@hugeicons/core-free-icons";
import type { CSSProperties } from "react";

import { cx, IconButton, type IconSvgElement } from "../kit/index";
import type { PanelId, Side } from "../layout/model";

/** A panel as its rail button shows it. */
export type RailPanel = { id: PanelId; title: string; icon: IconSvgElement };

export type RailProps = {
  side: Side;
  /** The column's panels; with none, one button opens the column. */
  panels: readonly RailPanel[];
  /** The panel the column shows, marked pressed. */
  active?: PanelId | null;
  onOpen: (panel: PanelId | null) => void;
  /** `horizontal` in the phone layout's bottom bar. */
  orientation?: "vertical" | "horizontal";
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const SIDE_NAME: Record<Side, string> = { left: "Left", right: "Right" };

/**
 * A collapsed column: one icon per panel, each opening the column on its
 * tab. The phone layout uses one as its panel bar.
 */
export function Rail({
  side,
  panels,
  active = null,
  onOpen,
  orientation = "vertical",
  label = `${SIDE_NAME[side]} panels`,
  className,
  style,
}: RailProps) {
  return (
    <nav
      data-je-region=""
      aria-label={label}
      className={cx("je-island je-frame-rail", className)}
      data-orientation={orientation}
      data-side={side}
      style={style}
    >
      {panels.length === 0 ? (
        <IconButton
          icon={side === "left" ? SidebarLeftIcon : SidebarRightIcon}
          label={`Show the ${side} column`}
          tooltipSide={side === "left" ? "right" : "left"}
          onClick={() => onOpen(null)}
        />
      ) : (
        panels.map((panel) => (
          <IconButton
            key={panel.id}
            icon={panel.icon}
            label={panel.title}
            aria-pressed={panel.id === active}
            tooltipSide={orientation === "horizontal" ? "top" : side === "left" ? "right" : "left"}
            onClick={() => onOpen(panel.id)}
          />
        ))
      )}
    </nav>
  );
}
