import type { ActionDef, Binding } from "@jams/engine/game";

const keys = (...codes: string[]): Binding[] => codes.map((code) => ({ device: "key", code }));

/** The runner's actions and their default bindings, in the order tools list them. */
export const PLATFORMER_ACTIONS: readonly ActionDef[] = [
  { action: "move_left", bindings: keys("ArrowLeft", "KeyA"), description: "Run left." },
  { action: "move_right", bindings: keys("ArrowRight", "KeyD"), description: "Run right." },
  {
    action: "jump",
    bindings: keys("ArrowUp", "KeyW", "Space"),
    description: "Jump; release early for a shorter hop. Wall-jumps while wall-sliding.",
  },
  {
    action: "move_down",
    bindings: keys("ArrowDown", "KeyS"),
    description: "Drop through the one-way platform underfoot.",
  },
  {
    action: "dash",
    bindings: keys("ShiftLeft", "ShiftRight"),
    description: "Short horizontal burst, on a cooldown.",
  },
  {
    action: "grapple",
    bindings: keys("KeyE"),
    description: "Hold while airborne to swing from the nearest anchor in range.",
  },
];
