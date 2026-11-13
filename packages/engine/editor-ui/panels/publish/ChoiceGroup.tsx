import type { ReactNode } from "react";

import { Hint, MicroLabel, Radio, Text } from "../../kit/index";

/**
 * A labelled radio group, one row per choice. An unavailable choice reads
 * muted and, given `hint`, says why on hover and focus.
 */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  choices,
  value,
  label,
  disabled,
  unavailable,
  hint,
  onPick,
}: {
  legend: string;
  name: string;
  choices: readonly T[];
  value: T;
  label: (choice: T) => ReactNode;
  disabled: boolean;
  unavailable?: (choice: T) => boolean;
  /** Why an unavailable choice can't be picked. */
  hint?: (choice: T) => string | null;
  onPick: (choice: T) => void;
}) {
  return (
    <div className="je-insp-stack" data-gap="tight" role="radiogroup" aria-label={legend}>
      <MicroLabel as="div">{legend}</MicroLabel>
      {choices.map((choice) => {
        const off = unavailable?.(choice) ?? false;
        const why = off ? (hint?.(choice) ?? null) : null;
        const row = (
          <label
            key={choice}
            className="je-insp-row"
            data-align="start"
            data-gap="tight"
            data-disabled={disabled || off ? "" : undefined}
            tabIndex={why ? 0 : undefined}
          >
            <Radio
              name={name}
              value={choice}
              checked={value === choice}
              disabled={disabled || off}
              onChange={() => onPick(choice)}
              {...(why ? { "aria-description": why } : {})}
            />
            <Text size="xs" variant={off ? "muted" : "primary"}>
              {label(choice)}
            </Text>
          </label>
        );
        return why ? (
          <Hint key={choice} content={why}>
            {row}
          </Hint>
        ) : (
          row
        );
      })}
    </div>
  );
}
