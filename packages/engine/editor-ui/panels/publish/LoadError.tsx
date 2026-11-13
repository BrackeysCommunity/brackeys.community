import type { ReactNode } from "react";

import { Button, Text, type TextTone } from "../../kit/index";

/**
 * A read that failed, with Try again: under its sentence, or beside it when
 * `inline` (a line of a list or a question).
 */
export function LoadError({
  text,
  onRetry,
  tone = "danger",
  role = "alert",
  inline = false,
  disabled = false,
}: {
  text: ReactNode;
  onRetry: () => void;
  tone?: TextTone;
  /** `listitem` when it stands for a line of a list. */
  role?: "alert" | "listitem";
  inline?: boolean;
  disabled?: boolean;
}) {
  const retry = (
    <Button size="xs" variant="outline" disabled={disabled} onClick={onRetry}>
      Try again
    </Button>
  );
  if (inline)
    return (
      <div className="je-insp-row je-insp-wrap" data-gap="tight" role={role}>
        <Text size="xs" variant={tone} className="je-insp-grow">
          {text}
        </Text>
        {retry}
      </div>
    );
  return (
    <div className="je-insp-stack" data-gap="tight" role={role}>
      <Text as="p" size="xs" variant={tone}>
        {text}
      </Text>
      <div className="je-insp-row">{retry}</div>
    </div>
  );
}
