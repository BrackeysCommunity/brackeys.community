import type { ActionDef, Binding, PadButton } from "@jams/engine/game";

const key = (code: string, axis?: "x" | "y", value?: number): Binding =>
  axis === undefined ? { device: "key", code } : { device: "key", code, axis, value };
const pad = (button: PadButton, axis?: "x" | "y", value?: number): Binding =>
  axis === undefined ? { device: "pad", button } : { device: "pad", button, axis, value };

/**
 * The skirmish's actions. Every one is UI-only: the HUD reads them to move
 * its cursor and pick orders, and only the commands it sends reach the
 * simulation.
 */
export const TACTICS_ACTIONS: readonly ActionDef[] = [
  {
    action: "cursor",
    kind: "vector",
    ui: true,
    bindings: [
      key("ArrowLeft", "x", -1),
      key("ArrowRight", "x", 1),
      key("ArrowUp", "y", -1),
      key("ArrowDown", "y", 1),
      key("KeyA", "x", -1),
      key("KeyD", "x", 1),
      key("KeyW", "y", -1),
      key("KeyS", "y", 1),
      pad("dpad-left", "x", -1),
      pad("dpad-right", "x", 1),
      pad("dpad-up", "y", -1),
      pad("dpad-down", "y", 1),
      { device: "pad", stick: "left" },
    ],
    description: "Move the board cursor one cell.",
  },
  {
    action: "confirm",
    ui: true,
    bindings: [key("Enter"), key("Space"), pad("south"), { device: "pointer", button: "primary" }],
    description: "Select the unit under the cursor, or give the order the cursor points at.",
  },
  {
    action: "cancel",
    ui: true,
    bindings: [key("Escape"), pad("east")],
    description: "Step back: drop the chosen target, then the selected unit.",
  },
  {
    action: "wait",
    ui: true,
    bindings: [key("KeyF"), pad("west")],
    description: "End the selected unit's turn where it stands.",
  },
  {
    action: "end-turn",
    ui: true,
    bindings: [key("KeyE"), pad("start")],
    description: "Hand the turn to the other side.",
  },
  {
    action: "next-unit",
    ui: true,
    bindings: [key("KeyQ"), pad("rb")],
    description: "Select the next unit of the side to act that still has orders.",
  },
];
