import type { ReactNode } from "react";

import { SWAP_TIMING_WORDS, SWAP_TIMINGS, type SwapTiming } from "../../../game/live";
import { Hint, MicroLabel, Radio, Text } from "../../kit/index";

/** Each timing's label on the choice that picks it. */
export const TIMING_TEXT = Object.freeze(
  Object.fromEntries(SWAP_TIMINGS.map((t) => [t, SWAP_TIMING_WORDS[t].label])),
) as Readonly<Record<SwapTiming, string>>;

/** The tooltip on a timing the game doesn't list. */
export const TIMING_UNDECLARED =
  "This game doesn't accept this timing (GameDefinition.live.timings).";

/**
 * A labelled radio group, one row per choice. A disabled group or an
 * unavailable choice reads muted; an unavailable one, given `hint`, says why
 * on hover and focus.
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
    <div
      className="je-insp-stack je-choice-group"
      data-gap="tight"
      role="radiogroup"
      aria-label={legend}
    >
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
            <Text size="xs" variant={disabled || off ? "muted" : "primary"}>
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

/** "When players get it": every timing, those the game doesn't accept disabled and saying why. */
export function TimingChoice({
  name,
  value,
  accepted,
  disabled,
  onPick,
}: {
  name: string;
  value: SwapTiming;
  /** The timings the game accepts, next load first. */
  accepted: readonly SwapTiming[];
  disabled: boolean;
  onPick: (timing: SwapTiming) => void;
}) {
  return (
    <ChoiceGroup
      legend="When players get it"
      name={name}
      choices={SWAP_TIMINGS}
      value={value}
      disabled={disabled}
      unavailable={(t) => !accepted.includes(t)}
      hint={() => TIMING_UNDECLARED}
      label={(t) => TIMING_TEXT[t]}
      onPick={onPick}
    />
  );
}
