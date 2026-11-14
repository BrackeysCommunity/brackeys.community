import { importLine, onBehaviors, type GameOptions } from ".";

/** The lines the presets' runtimes share: finding the goals and the hero, its body, the goal check and the slice. */
const SHARED = {
  findGoals: [
    `      goals = new Set(`,
    `        scene.entities`,
    `          .filter(`,
    `            (e) => e.type === "sensor" && (e.tags as string[] | undefined)?.includes(GOAL_TAG),`,
    `          )`,
    `          .map((e) => e.id),`,
    `      );`,
    `      const start = scene.entities.find((e) => e.type === HERO);`,
    `      if (!start) return;`,
  ],
  makeBody: [
    `      const half = (typeof start.size === "number" ? start.size : HERO_SIZE) / 2;`,
    `      const shape = { type: "box" as const, cx: 0, cy: 0, hw: half, hh: half, rotDeg: 0 };`,
  ],
  /** The goal check. */
  afterStep: [
    `    afterStep(_dtMs, events) {`,
    `      for (const e of events) {`,
    `        if (reached || e.type !== SENSOR_ENTER || e.other !== heroId) continue;`,
    `        if (e.entityId === undefined || !goals.has(e.entityId)) continue;`,
    `        reached = true;`,
    `        ctx.emit({ type: REACHED, entityId: e.entityId, other: heroId, at: e.at });`,
    `      }`,
    `    },`,
  ],
  slice: [
    `    storeSlice() {`,
    `      if (slice.reached !== reached) slice = { reached };`,
    `      return slice;`,
    `    },`,
  ],
};

/**
 * A behavior preset's runtime: no movement code and no goal check. The
 * hero's `collider`, character, `player-input` and `camera-target`
 * behaviors walk it and the camera follows; the goal's script declares the
 * win and drops the hero's seat, and the runtime keeps the snapshot.
 */
function behaviorRuntime(): string {
  return [
    `import type { EngineContext, GameRuntime } from "@jams/engine/game";`,
    ``,
    `import { HERO, REACHED, type Slice, type Snapshot } from "./types";`,
    ``,
    `/** Follows the hero for the snapshot; its behaviors move it and the goal's script wins. */`,
    `export function createRuntime(ctx: EngineContext): GameRuntime<Snapshot> {`,
    `  let heroId: string | null = null;`,
    `  let moving = false;`,
    `  let reached = false;`,
    `  let slice: Slice = { reached };`,
    ``,
    `  return {`,
    `    onLoad(scene) {`,
    `      heroId = scene.entities.find((e) => e.type === HERO)?.id ?? null;`,
    `    },`,
    `    onUnload() {`,
    `      heroId = null;`,
    `      moving = false;`,
    `      reached = false;`,
    `    },`,
    `    beforeStep(_dtMs, actions) {`,
    `      for (const a of actions) if (a.action === "move") moving = a.pressed;`,
    `    },`,
    `    afterStep(_dtMs, events) {`,
    `      if (events.some((e) => e.type === REACHED)) reached = true;`,
    `    },`,
    `    // An event clock keeps ticking while \`move\` is held or the hero still moves.`,
    `    busy() {`,
    `      if (moving) return true;`,
    `      if (heroId === null || !ctx.bodies.has(heroId)) return false;`,
    `      const v = ctx.bodies.velocity(heroId);`,
    `      return v.x !== 0 || v.y !== 0;`,
    `    },`,
    `    snapshot() {`,
    `      const pose = heroId === null ? undefined : ctx.poses.get(heroId);`,
    `      return { at: pose ? { x: pose.x, y: pose.y } : null, reached };`,
    `    },`,
    ...SHARED.slice,
    `  };`,
    `}`,
    ``,
  ].join("\n");
}

function gridRuntime(options: GameOptions): string {
  const s = SHARED;
  const turns = options.preset === "turns";
  return [
    ...(turns ? [] : [`import type { Vec2 } from "@jams/engine";`]),
    `import {`,
    `  createGridStepper,`,
    `  createMotionBody,`,
    `  SENSOR_ENTER,`,
    `  type Cell,`,
    `  type EngineContext,`,
    `  type GameRuntime,`,
    `  type GridStepper,`,
    `  type MotionBody,`,
    `} from "@jams/engine/game";`,
    ``,
    ...importLine(
      [
        ...(turns ? ["DIRECTIONS"] : []),
        "GOAL_TAG",
        "HERO",
        "HERO_SIZE",
        "REACHED",
        ...(turns ? ["STEP", "type Direction"] : []),
        "type Slice",
        "type Snapshot",
      ],
      "./types",
    ),
    ``,
    `/** How long one step from cell to cell takes. */`,
    `const MS_PER_STEP = 150;`,
    ``,
    turns
      ? `const OFFSETS: Readonly<Record<Direction, Cell>> = {`
      : `/** The neighbour a \`move\` vector points at: its larger axis wins. */`,
    ...(turns
      ? [`  left: [-1, 0],`, `  right: [1, 0],`, `  up: [0, -1],`, `  down: [0, 1],`, `};`]
      : [
          `function offsetOf(v: Vec2): Cell | null {`,
          `  if (v.x === 0 && v.y === 0) return null;`,
          `  if (Math.abs(v.x) >= Math.abs(v.y)) return [Math.sign(v.x), 0];`,
          `  return [0, Math.sign(v.y)];`,
          `}`,
        ]),
    ``,
    turns
      ? `/** Walks the hero one cell per \`step\` command, queued while it walks, and raises \`REACHED\` at a goal. */`
      : `/** Walks the hero cell by cell while \`move\` is held, and raises \`REACHED\` at a goal. */`,
    `export function createRuntime(ctx: EngineContext): GameRuntime<Snapshot> {`,
    `  let body: MotionBody | null = null;`,
    `  let stepper: GridStepper | null = null;`,
    `  let heroId: string | null = null;`,
    `  let goals = new Set<string>();`,
    turns ? `  let queue: Direction[] = [];` : `  let intent: Vec2 = { x: 0, y: 0 };`,
    `  let reached = false;`,
    `  let slice: Slice = { reached };`,
    ``,
    `  const next = (offset: Cell): Cell | null => {`,
    `    const at = stepper?.cell();`,
    `    return at ? [at[0] + offset[0], at[1] + offset[1]] : null;`,
    `  };`,
    ``,
    `  return {`,
    `    onLoad(scene) {`,
    ...s.findGoals,
    `      const grid = ctx.grid;`,
    `      if (!grid) return;`,
    `      const [x, y] = start.at as [number, number];`,
    `      const cell = grid.geometry.cellAt([x, y]);`,
    `      const [cx, cy] = grid.geometry.center(cell);`,
    ...s.makeBody,
    `      body = createMotionBody(ctx, start, { x: cx, y: cy }, { shape });`,
    `      stepper = createGridStepper(ctx, start.id, {`,
    `        start: cell,`,
    `        msPerStep: MS_PER_STEP,`,
    `        body,`,
    `        occupy: true,`,
    `      });`,
    `      heroId = start.id;`,
    `    },`,
    `    onUnload() {`,
    `      body = null;`,
    `      stepper = null;`,
    `      heroId = null;`,
    `      goals.clear();`,
    turns ? `      queue = [];` : `      intent = { x: 0, y: 0 };`,
    `      reached = false;`,
    `    },`,
    ...(turns
      ? [
          `    beforeStep(dtMs, _actions, commands) {`,
          `      for (const c of commands) {`,
          `        const dir = (c.args as { dir?: Direction } | undefined)?.dir;`,
          `        if (c.name === STEP && dir !== undefined) queue.push(dir);`,
          `      }`,
          `      if (!stepper) return;`,
          `      stepper.update(dtMs);`,
          `      while (!stepper.moving() && !reached && queue.length > 0) {`,
          `        const to = next(OFFSETS[queue.shift()!]);`,
          `        if (to) stepper.step(to);`,
          `      }`,
          `    },`,
        ]
      : [
          `    beforeStep(dtMs, actions) {`,
          `      for (const a of actions) {`,
          `        if (a.action === "move") intent = a.pressed ? { x: a.x ?? 0, y: a.y ?? 0 } : { x: 0, y: 0 };`,
          `      }`,
          `      if (!stepper) return;`,
          `      stepper.update(dtMs);`,
          `      const offset = offsetOf(intent);`,
          `      const to = offset && next(offset);`,
          `      if (to && !reached && !stepper.moving()) stepper.step(to);`,
          `    },`,
        ]),
    ...s.afterStep,
    turns
      ? `    // Ticks run while the hero walks or has steps queued.`
      : `    // The event clock keeps ticking while the hero walks or \`move\` is held.`,
    turns
      ? `    busy: () => (stepper?.moving() ?? false) || queue.length > 0,`
      : `    busy: () => (stepper?.moving() ?? false) || intent.x !== 0 || intent.y !== 0,`,
    `    cameraTarget: () => body?.position() ?? null,`,
    `    snapshot() {`,
    ...(turns
      ? [
          `      const idle = stepper !== null && !stepper.moving() && queue.length === 0;`,
          `      const moves = DIRECTIONS.filter((dir) => {`,
          `        const to = next(OFFSETS[dir]);`,
          `        return idle && to !== null && (ctx.grid?.passable(to) ?? false);`,
          `      });`,
          `      return { at: body?.position() ?? null, cell: stepper?.cell() ?? null, moves, reached };`,
        ]
      : [`      return { at: body?.position() ?? null, cell: stepper?.cell() ?? null, reached };`]),
    `    },`,
    ...s.slice,
    `  };`,
    `}`,
    ``,
  ].join("\n");
}

/** `runtime.ts`: the game's per-scene state, per preset. */
export function runtimeFile(options: GameOptions): string {
  return onBehaviors(options) ? behaviorRuntime() : gridRuntime(options);
}
