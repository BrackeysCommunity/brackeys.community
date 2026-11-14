import type { SceneTemplate } from "@jams/engine/game";

import { importLine, onBehaviors, type GameGrid, type GameNames, type GameOptions } from ".";

/** A number as code writes it. */
const num = (n: number): string => String(n);

/** An object key as code writes it: bare when it is an identifier, else quoted. */
const key = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/** A JSON-like value as a TS literal on one line: double quotes, spaces inside braces. */
function literal(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${key(k)}: ${literal(v)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return typeof value === "string" ? JSON.stringify(value) : num(value as number);
}

/**
 * `value` as `vp fmt` prints it, starting `used` columns into a line at
 * `indent` with `tail` columns after it: on one line when it fits the print
 * width, else an object one key per line, each value printed the same way.
 */
function printed(value: unknown, indent: string, used: number, tail: number): string {
  const one = literal(value);
  if (used + one.length + tail <= 100 || value === null || typeof value !== "object") return one;
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return `[\n${value.map((v) => `${inner}${printed(v, inner, inner.length, 1)},`).join("\n")}\n${indent}]`;
  const lines = Object.entries(value).map(([k, v]) => {
    const head = `${inner}${key(k)}: `;
    return `${head}${printed(v, inner, head.length, 1)},`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** A literal as an item of a list at `indent`, as `vp fmt` prints it. */
const item = (value: unknown, indent: string): string[] => [
  `${indent}${printed(value, indent, indent.length, 1)},`,
];

/** The `grid` a game's `world` declares. */
function gridLiteral(grid: GameGrid): string {
  const cell = `[${num(grid.cell)}, ${num(grid.cell)}]`;
  if (grid.kind === "square") return `{ kind: "square", cell: ${cell} }`;
  return `{ kind: "hex", cell: ${cell}, side: ${num(grid.cell / 2)}, stagger: "y", index: "odd" }`;
}

const isGridPreset = (options: GameOptions) => !onBehaviors(options);

/** `index.ts`: the game definition, every world and time field written out. */
export function indexFile(options: GameOptions, names: GameNames): string {
  const world = [
    `    physics: ${JSON.stringify(options.physics)},`,
    `    gravity: [${num(options.gravity[0])}, ${num(options.gravity[1])}],`,
    ...(options.grid ? [`    grid: ${gridLiteral(options.grid)},`] : []),
    `    lengthUnit: ${num(options.lengthUnit)},`,
  ];
  const turns = options.preset === "turns";
  const what =
    options.preset === "top-down"
      ? "steers a hero round a wall"
      : options.preset === "side-view"
        ? "runs and jumps a hero up a ledge"
        : turns
          ? "steps a hero cell by cell, one `step` command at a time,"
          : "steps a hero cell by cell";
  const pxPerCell = options.grid ? options.grid.cell * options.lengthUnit : null;
  return [
    `import { defineGame } from "@jams/engine/game";`,
    ...(turns ? [`import { z } from "zod";`] : []),
    ``,
    `import { ACTIONS } from "./actions";`,
    ...(onBehaviors(options) ? [`import { Goal } from "./goal";`] : []),
    `import { PLAY } from "./play";`,
    `import { createRuntime } from "./runtime";`,
    `import { TEMPLATE } from "./template";`,
    ...importLine(
      [
        ...(turns ? ["DIRECTIONS"] : []),
        "GAME_ID",
        "heroType",
        ...(turns ? ["STEP"] : []),
        "type Snapshot",
      ],
      "./types",
    ),
    ``,
    `/** ${options.name}: a game that ${what} to a goal. */`,
    `export const ${names.gameExport} = defineGame<Snapshot>({`,
    `  id: GAME_ID,`,
    `  types: [heroType],`,
    `  actions: ACTIONS,`,
    ...(onBehaviors(options) ? [`  behaviors: [Goal],`] : []),
    `  // The hero's body moves into sensors.`,
    `  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },`,
    pxPerCell === null
      ? `  // Metres in the simulation, ${num(options.lengthUnit)} px per metre on screen.`
      : `  // Metres in the simulation, ${num(options.lengthUnit)} px per metre on screen: ${num(pxPerCell)} px cells.`,
    `  world: {`,
    ...world,
    `  },`,
    `  time: { kind: ${JSON.stringify(options.time.kind)}, rate: ${num(options.time.rate)} },`,
    ...(turns
      ? [
          `  commands: {`,
          `    [STEP]: {`,
          `      description: "Step the hero to the next cell that way.",`,
          `      args: z.strictObject({ dir: z.enum(DIRECTIONS).describe("Which way to step.") }),`,
          `    },`,
          `  },`,
        ]
      : []),
    `  play: PLAY,`,
    `  template: TEMPLATE,`,
    `  createRuntime,`,
    `});`,
    ``,
  ].join("\n");
}

/** `types.ts`: the game's id and event, the hero type, the goal's tag, the snapshot and the HUD's slice. */
export function typesFile(options: GameOptions, names: GameNames): string {
  const grid = isGridPreset(options);
  const turns = options.preset === "turns";
  const behaviors = onBehaviors(options);
  return [
    `import type { Vec2 } from "@jams/engine";`,
    `import { defineEntityType, pointField${grid ? ", type Cell" : ""} } from "@jams/engine/game";`,
    ...(behaviors ? [] : [`import { z } from "zod";`]),
    ``,
    `export const GAME_ID = ${JSON.stringify(names.id)};`,
    ``,
    `/** Raised when the hero enters a goal: the run is won. */`,
    `export const REACHED = \`\${GAME_ID}:reached\`;`,
    ``,
    `/** The tag on the sensors the hero must reach: a goal is a plain \`sensor\` with it. */`,
    `export const GOAL_TAG = "goal";`,
    ``,
    `export const HERO = "hero";`,
    ...(behaviors
      ? [
          ``,
          `/** The hero: its behaviors (a collider, a character, player input and a camera target) move it. */`,
          `export const heroType = defineEntityType({`,
          `  type: HERO,`,
          `  description: "The hero, moved by its character behavior from the player's input.",`,
          `  base: "marker",`,
          `  fields: { at: pointField("Where the hero starts.") },`,
          `});`,
        ]
      : [
          `/** The hero's width and height when its entity doesn't give one, m. */`,
          `export const HERO_SIZE = 0.5;`,
          ``,
          `/** Where the hero starts; the game makes its body there. */`,
          `export const heroType = defineEntityType({`,
          `  type: HERO,`,
          `  description: "Where the hero starts; the game moves it.",`,
          `  base: "marker",`,
          `  fields: {`,
          `    at: pointField(${JSON.stringify(grid ? "The cell the hero starts on, by its centre." : "Where the hero starts.")}),`,
          `    size: z`,
          `      .number()`,
          `      .positive()`,
          `      .optional()`,
          `      .describe(\`The hero's width and height, m; default \${HERO_SIZE}.\`)`,
          `      .meta({ unit: "m" }),`,
          `  },`,
          `});`,
        ]),
    ``,
    ...(turns
      ? [
          `/** The \`step\` command and the ways it can go. */`,
          `export const STEP = "step";`,
          `export const DIRECTIONS = ["left", "right", "up", "down"] as const;`,
          `export type Direction = (typeof DIRECTIONS)[number];`,
          ``,
        ]
      : []),
    `export type Snapshot = {`,
    `  /** The hero's position, m; null before a scene with a hero loads. */`,
    `  at: Vec2 | null;`,
    ...(grid
      ? [`  /** The cell the hero stands on, or is stepping onto. */`, `  cell: Cell | null;`]
      : []),
    ...(turns
      ? [
          `  /** The ways a \`step\` can go now; empty while the hero walks. */`,
          `  moves: Direction[];`,
        ]
      : []),
    `  reached: boolean;`,
    `};`,
    ``,
    `/** What the HUD reads from the store; the same object until something in it changes. */`,
    `export type Slice = { reached: boolean };`,
    ``,
  ].join("\n");
}

/** `actions.ts`: `move` (a vector) and the HUD's UI-only `pause`. */
export function actionsFile(options: GameOptions): string {
  const turns = options.preset === "turns";
  const side = options.preset === "side-view";
  // A side-view hero runs on x alone, which leaves up for the jump.
  const moveBindings = [
    `      key("ArrowLeft", "x", -1),`,
    `      key("ArrowRight", "x", 1),`,
    `      key("ArrowUp", "y", -1),`,
    `      key("ArrowDown", "y", 1),`,
    `      key("KeyA", "x", -1),`,
    `      key("KeyD", "x", 1),`,
    `      key("KeyW", "y", -1),`,
    `      key("KeyS", "y", 1),`,
    `      pad("dpad-left", "x", -1),`,
    `      pad("dpad-right", "x", 1),`,
    `      pad("dpad-up", "y", -1),`,
    `      pad("dpad-down", "y", 1),`,
    `      { device: "pad", stick: "left" },`,
  ].filter((line) => !side || !line.includes(`"y"`));
  const moveDescription = turns
    ? "Step the hero one cell."
    : isGridPreset(options)
      ? "Walk the hero cell by cell."
      : side
        ? "Run the hero left and right."
        : "Steer the hero.";
  return [
    `import type { ActionDef, Binding, PadButton } from "@jams/engine/game";`,
    ``,
    `const key = (code: string, axis: "x" | "y", value: number): Binding => ({`,
    `  device: "key",`,
    `  code,`,
    `  axis,`,
    `  value,`,
    `});`,
    `const pad = (button: PadButton, axis: "x" | "y", value: number): Binding => ({`,
    `  device: "pad",`,
    `  button,`,
    `  axis,`,
    `  value,`,
    `});`,
    ``,
    turns
      ? `/** Both actions are UI-only: the HUD sends \`move\` on as \`step\` commands, all the simulation hears. */`
      : side
        ? `/** \`move\` runs the hero and \`jump\` jumps; \`pause\` is UI-only, the HUD's, and never reaches the simulation. */`
        : `/** \`move\` steers the hero; \`pause\` is UI-only, the HUD's, and never reaches the simulation. */`,
    `export const ACTIONS: readonly ActionDef[] = [`,
    `  {`,
    `    action: "move",`,
    `    kind: "vector",`,
    ...(turns ? [`    ui: true,`] : []),
    `    bindings: [`,
    ...moveBindings,
    `    ],`,
    `    description: ${JSON.stringify(moveDescription)},`,
    `  },`,
    ...(side
      ? [
          `  {`,
          `    action: "jump",`,
          `    bindings: [`,
          `      { device: "key", code: "Space" },`,
          `      { device: "key", code: "ArrowUp" },`,
          `      { device: "key", code: "KeyW" },`,
          `      { device: "pad", button: "south" },`,
          `    ],`,
          `    description: "Jump; let go early for a lower jump.",`,
          `  },`,
        ]
      : []),
    `  {`,
    `    action: "pause",`,
    `    ui: true,`,
    `    bindings: [`,
    `      { device: "key", code: "KeyP" },`,
    `      { device: "pad", button: "start" },`,
    `    ],`,
    `    description: "Pause or resume the game.",`,
    `  },`,
    `];`,
    ``,
  ].join("\n");
}

/** `play.ts`: the game's result and focus, and per preset a predicate or its legal commands. */
export function playFile(options: GameOptions): string {
  const grid = isGridPreset(options);
  const turns = options.preset === "turns";
  return [
    `import type { GamePlayDef } from "@jams/engine/game";`,
    ...(grid ? [`import { z } from "zod";`] : []),
    ``,
    ...importLine(["REACHED", ...(turns ? ["STEP"] : []), "type Snapshot"], "./types"),
    ``,
    `/** Won when the hero reaches a goal. */`,
    `export const PLAY: GamePlayDef<Snapshot> = {`,
    `  results: ["won"],`,
    `  focus: (snapshot) => snapshot.at,`,
    ...(turns ? [] : [`  movementActions: ["move"],`]),
    `  outcome({ events }) {`,
    `    const goal = events.find((e) => e.type === REACHED);`,
    `    return goal`,
    `      ? { result: "won", cause: "the hero reached the goal", entityId: goal.entityId }`,
    `      : null;`,
    `  },`,
    ...(grid
      ? [
          `  predicates: {`,
          `    cell: {`,
          `      description: "The hero stands on, or is stepping onto, this cell: [col, row].",`,
          `      arg: z.tuple([z.number().int(), z.number().int()]),`,
          `      test(arg, { snapshot }) {`,
          `        const [col, row] = arg as [number, number];`,
          `        return snapshot.cell?.[0] === col && snapshot.cell[1] === row;`,
          `      },`,
          `    },`,
          `  },`,
        ]
      : []),
    ...(turns
      ? [
          `  commands: ({ snapshot }) =>`,
          `    snapshot.reached ? [] : snapshot.moves.map((dir) => ({ name: STEP, args: { dir } })),`,
        ]
      : []),
    `};`,
    ``,
  ].join("\n");
}

/** `template.ts`: what \`vp run scene new\` starts a scene of the game with. */
export function templateFile(template: SceneTemplate): string {
  const rows = (key: string, items: readonly unknown[]) => [
    `  ${key}: [`,
    ...items.flatMap((v) => item(v, "    ")),
    `  ],`,
  ];
  return [
    `import type { SceneTemplate } from "@jams/engine/game";`,
    ``,
    `/** A walled room with the hero and a goal, in metres. */`,
    `export const TEMPLATE: SceneTemplate = {`,
    `  bounds: ${literal(template.bounds)},`,
    ...rows("solid", (template.solid as unknown[] | undefined) ?? []),
    ...rows("entities", template.entities ?? []),
    `};`,
    ``,
  ].join("\n");
}
