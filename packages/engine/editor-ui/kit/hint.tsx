import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { usePortalContainer } from "./context";
import { cx } from "./cx";

/** How long a pointer rests on a control before its hint shows, so a pass across a toolbar opens nothing. */
export const HINT_DELAY_MS = 500;

export type HintSide = "top" | "bottom" | "left" | "right";

export type HintProps = {
  content: ReactNode;
  side?: HintSide;
  tone?: "default" | "error";
  maxWidth?: number;
  /** The pointer may move onto the hint without closing it. */
  hoverable?: boolean;
  disabled?: boolean;
  delay?: number;
  /** Holds the hint open (an error to read). */
  open?: boolean;
  className?: string;
  /** The trigger itself: its element gets the hover and focus handlers, so no second button wraps it. */
  children: ReactElement;
};

/** A hover and focus hint on a control; the editor's stand-in for a native `title`. */
export function Hint({
  content,
  side = "top",
  tone = "default",
  maxWidth = 240,
  hoverable = false,
  disabled = false,
  delay = HINT_DELAY_MS,
  open,
  className,
  children,
}: HintProps) {
  const container = usePortalContainer();
  if (disabled || content == null || content === false || content === "") return children;
  return (
    <Tooltip.Provider delay={delay} closeDelay={0}>
      <Tooltip.Root disableHoverablePopup={!hoverable} open={open}>
        <Tooltip.Trigger render={children} />
        <Tooltip.Portal container={container}>
          <Tooltip.Positioner side={side} sideOffset={8} className="je-positioner">
            <Tooltip.Popup
              className={cx("je-hint", className)}
              data-tone={tone}
              style={{ maxWidth }}
            >
              {content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
