import type { ActionDef } from "@jams/engine/game";

/** The runner's actions and their default keys, in the order tools list them. */
export const PLATFORMER_ACTIONS: readonly ActionDef[] = [
  { action: "move_left", keys: ["ArrowLeft", "a"], description: "Run left." },
  { action: "move_right", keys: ["ArrowRight", "d"], description: "Run right." },
  {
    action: "jump",
    keys: ["ArrowUp", "w", " "],
    description: "Jump; release early for a shorter hop. Wall-jumps while wall-sliding.",
  },
  {
    action: "move_down",
    keys: ["ArrowDown", "s"],
    description: "Drop through the one-way platform underfoot.",
  },
  { action: "dash", keys: ["Shift"], description: "Short horizontal burst, on a cooldown." },
  {
    action: "grapple",
    keys: ["e"],
    description: "Hold while airborne to swing from the nearest anchor in range.",
  },
];
