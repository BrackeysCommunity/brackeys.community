/** The platformer's entity type names, for systems and hooks that look each other up. */
export const TYPE = {
  cloud: "cloud",
  mover: "mover",
  anchor: "anchor",
  construct: "construct",
  goal: "goal",
  exit: "exit",
  hazard: "hazard",
  spawn: "spawn",
} as const;
