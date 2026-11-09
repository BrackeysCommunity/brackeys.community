import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ReactNode } from "react";

import type { EditorCue } from "../host";
import { useBusy } from "../pending/use-pending";
import { useKit } from "./context";
import { cx } from "./cx";
import { Hint, type HintSide } from "./hint";
import { Icon, type IconSvgElement } from "./icon";
import { Spinner } from "./spinner";

export type ButtonVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
export type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** The leading icon; a busy button shows its spinner in this slot. */
  icon?: IconSvgElement;
  /**
   * Work this button started is running: a spinner, `aria-busy`, presses
   * ignored, and the same width, so the row around it doesn't move.
   */
  busy?: boolean;
  /** Busy too while a pending task runs in this scope (`project:rename:<assetId>`). */
  busyScope?: string;
  tooltip?: ReactNode;
  tooltipSide?: HintSide;
  /** The sound a press makes; null for none. */
  cue?: EditorCue | null;
};

const ICON_PX: Partial<Record<ButtonSize, number>> = { xs: 12, "icon-xs": 12, sm: 13 };

export function Button({
  variant = "default",
  size = "default",
  className,
  icon,
  busy: busyProp = false,
  busyScope,
  tooltip,
  tooltipSide,
  cue = "press",
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const kit = useKit();
  const scoped = useBusy(busyScope ?? "");
  const busy = busyProp || (busyScope !== undefined && scoped !== undefined);
  const iconPx = ICON_PX[size] ?? 14;
  const button = (
    <ButtonPrimitive
      {...props}
      className={cx("je-btn", className)}
      data-variant={variant}
      data-size={size}
      data-busy={busy ? "" : undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      focusableWhenDisabled={busy || props.focusableWhenDisabled}
      onClick={(event) => {
        if (busy || disabled) {
          event.preventDefault();
          return;
        }
        if (cue) kit.cue(cue);
        onClick?.(event);
      }}
    >
      {icon ? (
        <span className="je-btn-icon" aria-hidden>
          {busy ? <Spinner size={iconPx} label={null} /> : <Icon icon={icon} size={iconPx} />}
        </span>
      ) : null}
      {children != null && children !== false ? (
        <span className="je-btn-label">{children}</span>
      ) : null}
      {busy && !icon ? (
        <span className="je-btn-busy" aria-hidden>
          <Spinner size={iconPx} label={null} />
        </span>
      ) : null}
    </ButtonPrimitive>
  );
  return tooltip ? (
    <Hint content={tooltip} side={tooltipSide}>
      {button}
    </Hint>
  ) : (
    button
  );
}

export type IconButtonProps = Omit<ButtonProps, "icon" | "children" | "size"> & {
  icon: IconSvgElement;
  /** The accessible name, and the hint unless `tooltip` says otherwise. */
  label: string;
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg";
};

/** A square button with one icon, named by `label`. */
export function IconButton({
  icon,
  label,
  size = "icon-sm",
  variant = "ghost",
  tooltip,
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      icon={icon}
      size={size}
      variant={variant}
      aria-label={label}
      tooltip={tooltip === undefined ? label : tooltip}
    />
  );
}
