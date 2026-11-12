import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Confirm, IconButton } from "../../kit/index";

/** A small remove button that asks first, through the editor's `Confirm`. */
export function RemoveButton({
  label,
  title,
  message,
  disabled,
  className,
  onConfirm,
}: {
  /** The button's accessible name and hint. */
  label: string;
  title: string;
  message: string;
  disabled?: boolean;
  className?: string;
  onConfirm: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        size="icon-xs"
        className={className}
        icon={Cancel01Icon}
        label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <Confirm
        open={open}
        onOpenChange={setOpen}
        title={title}
        message={message}
        confirmText="Remove"
        variant="destructive"
        onConfirm={onConfirm}
      />
    </>
  );
}
