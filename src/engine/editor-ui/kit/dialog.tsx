import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";

import { IconButton } from "./button";
import { usePortalContainer } from "./context";
import { cx } from "./cx";

type Cls<P> = Omit<P, "className"> & { className?: string };

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** A modal over the editor, with a close button unless `showCloseButton` is false. */
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Cls<DialogPrimitive.Popup.Props> & { showCloseButton?: boolean }) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Backdrop className="je-backdrop" />
      <DialogPrimitive.Popup {...props} className={cx("je-dialog", className)}>
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            render={
              <IconButton
                icon={Cancel01Icon}
                label="Close"
                cue={null}
                className="je-dialog-close"
              />
            }
          />
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("je-dialog-header", className)} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("je-dialog-footer", className)} />;
}

export function DialogTitle({ className, ...props }: Cls<DialogPrimitive.Title.Props>) {
  return <DialogPrimitive.Title {...props} className={cx("je-dialog-title", className)} />;
}

export function DialogDescription({ className, ...props }: Cls<DialogPrimitive.Description.Props>) {
  return (
    <DialogPrimitive.Description {...props} className={cx("je-dialog-description", className)} />
  );
}
