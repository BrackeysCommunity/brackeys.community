import { createTouchControls, type TouchControlDef, type TouchControlValue } from "@jams/engine";

/** The duel's controls: `at` and `radius` are fractions of the frame's shorter side, from its top-left. */
export const DUEL_TOUCH: TouchControlDef[] = [
  { id: "stick", kind: "stick", action: "move", at: [0.2, 0.8], radius: 0.15 },
  { id: "taunt", kind: "button", action: "taunt", at: [1.55, 0.8], radius: 0.1, label: "Hi" },
];

/**
 * An overlay over `frame` outside `createGame`, e.g. a menu's own pad: each
 * control reports its value whenever it changes, a stick in the unit disc
 * (y down, quantised), a button as `{ down }`.
 */
export function mountPad(frame: HTMLElement) {
  const seen: [control: string, value: TouchControlValue][] = [];
  const pad = createTouchControls(frame, DUEL_TOUCH, (control, value) =>
    seen.push([control, value]),
  );
  return { pad, seen };
}
