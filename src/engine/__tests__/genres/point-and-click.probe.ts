import { defineEntityType, defineGame } from "../../game/define";
import { shapeField } from "../../game/fields";
import type { EngineContext } from "../../game/types";
import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import { createMotionBody, type MotionBody } from "../../motion/body";
import { SCENE_FORMAT_VERSION, type Pt, type SceneDefinition } from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "point-and-click";
const HOTSPOT = `${ID}-hotspot`;
/** The tag on the marker the walker starts at. */
const WALKER = "walker";
/** Raised when the walker reaches the end of a path. */
export const ARRIVED = `${ID}:arrived`;
/** Raised when the walker reaches a clicked hotspot, which then fires. */
export const TRIGGERED = `${ID}:triggered`;

/** Walking speed, m/s. */
const SPEED = 3;
/** The walker's radius, m. */
const RADIUS = 0.2;
/** The primary button's bit in `PointerState.buttons`. */
const PRIMARY = 1;

export type PointAndClickSnapshot = {
  at: Vec2 | null;
  walking: boolean;
  /** Primary presses read from the pointer. */
  clicks: number;
  /** Presses on neither a hotspot nor a walk area. */
  ignored: number;
  /** The hotspots fired, in order. */
  triggered: string[];
  /** Every path the walker took, from where it stood, corners included. */
  paths: Vec2[][];
};

const hotspot = defineEntityType({
  type: HOTSPOT,
  description: "Something to click: the walker goes to it, and it fires when the walker arrives.",
  base: "sensor",
  fields: { shape: shapeField("The clickable area.") },
});

const dist = (a: Vec2, b: Vec2) => Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));

/**
 * A point-and-click room with no physics. A primary press on a hotspot
 * (`ctx.space.pointAt`, sensors of the hotspot type only) sends the walker
 * to the walk area's nearest point to the hotspot, and the hotspot fires
 * when it arrives; a press elsewhere on a walk area sends it there along
 * `ctx.nav`'s path; any other press is ignored. The game reads presses from
 * `ctx.input.pointer()`, so a replay rebuilds them from the recording.
 */
const game = defineGame<PointAndClickSnapshot>({
  id: ID,
  types: [hotspot],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed" },
  play: {
    results: ["won"],
    markers: [ARRIVED, TRIGGERED],
    focus: (snap) => snap.at,
    outcome: ({ snapshot }) =>
      snapshot.triggered.length > 0
        ? { result: "won", cause: `the walker used ${snapshot.triggered[0]}` }
        : null,
  },
  createRuntime(ctx: EngineContext) {
    let walker: MotionBody | null = null;
    let route: Vec2[] = [];
    let goal: string | null = null;
    let buttons = 0;
    let clicks = 0;
    let ignored = 0;
    const triggered: string[] = [];
    const paths: Vec2[][] = [];

    const centreOf = (id: string): Vec2 | null => {
      const p = ctx.poses.get(id);
      return p ? { x: p.x, y: p.y } : null;
    };

    function walkTo(to: Vec2, target: string | null): boolean {
      const nav = ctx.nav;
      if (!walker || !nav) return false;
      const path = nav.path(walker.position(), nav.contains(to) ? to : nav.nearest(to));
      if (!path) return false;
      paths.push(path);
      route = path.slice(1);
      goal = target;
      return true;
    }

    function click(p: Vec2): void {
      clicks++;
      const [hit] = ctx.space.pointAt(p, { sensors: true, types: [HOTSPOT] });
      if (hit) {
        const centre = centreOf(hit.tag.entityId) ?? p;
        if (walkTo(centre, hit.tag.entityId)) return;
      } else if (ctx.nav?.contains(p) && walkTo(p, null)) return;
      ignored++;
    }

    function arrive(): void {
      if (!walker) return;
      const p = walker.position();
      ctx.emit({ type: ARRIVED, entityId: walker.entityId, at: p });
      if (goal === null) return;
      triggered.push(goal);
      ctx.emit({ type: TRIGGERED, entityId: goal, other: walker.entityId, at: p });
      goal = null;
    }

    function walk(dtMs: number): void {
      if (!walker || route.length === 0) return;
      let budget = (SPEED * dtMs) / 1000;
      while (budget > 0) {
        const next = route[0];
        if (!next) break;
        const from = walker.position();
        const d = dist(from, next);
        if (d <= budget) {
          walker.move({ x: next.x - from.x, y: next.y - from.y }, { slide: false });
          budget -= d;
          route.shift();
        } else {
          const k = budget / d;
          walker.move({ x: (next.x - from.x) * k, y: (next.y - from.y) * k }, { slide: false });
          budget = 0;
        }
      }
      if (route.length === 0) arrive();
    }

    return {
      onLoad(scene) {
        const start = scene.entities.find(
          (e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(WALKER),
        );
        if (!start) return;
        const [x, y] = start.at as Pt;
        walker = createMotionBody(
          ctx,
          { id: start.id, type: start.type },
          { x, y },
          {
            shape: { type: "circle", cx: 0, cy: 0, r: RADIUS },
          },
        );
      },
      onUnload() {
        walker = null;
        route = [];
        goal = null;
        buttons = 0;
      },
      beforeStep(dtMs) {
        const pointer = ctx.input.pointer();
        const now = pointer?.buttons ?? 0;
        if (pointer && now & PRIMARY && !(buttons & PRIMARY)) click(pointer);
        buttons = now;
        walk(dtMs);
      },
      snapshot: () => ({
        at: walker?.position() ?? null,
        walking: route.length > 0,
        clicks,
        ignored,
        triggered: [...triggered],
        paths: paths.map((p) => [...p]),
      }),
    };
  },
});

/*
 * An L-shaped room in metres: a top arm 0.5–7.5 m by 0.5–2.5 m and a left
 * arm 0.5–2.5 m by 0.5–5.5 m, meeting at the inner corner (2.5, 2.5). The
 * walker starts at the east end of the top arm; a door hotspot sits on the
 * east wall, past the walk area's edge.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "point-and-click-probe",
  bounds: [0, 0, 8, 6],
  settings: { physics: "none", gravity: [0, 0] },
  entities: [
    {
      id: "room",
      type: "nav",
      shape: ["poly", 0.5, 0.5, 7.5, 0.5, 7.5, 2.5, 2.5, 2.5, 2.5, 5.5, 0.5, 5.5],
    },
    { id: "door", type: HOTSPOT, shape: ["box", 7.75, 1.5, 0.25, 0.5] },
    { id: "walker", type: "marker", at: [6.5, 1.5], tags: [WALKER] },
  ],
};

const click = (at: Pt): InputScriptStepV2 => ({
  pointer: { at, press: "primary", release: "primary" },
  for: 2,
});
/** Nothing held until the event, at most `max` ticks. */
const awaitEvent = (event: string): InputScriptStepV2 => ({ hold: [], until: { event }, max: 400 });

/**
 * Three clicks: one in the room's empty notch (ignored), one at the foot of
 * the left arm (a walk round the inner corner), and one on the door (a walk
 * back round the corner to it, then the door fires).
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  maxTicks: 900,
  steps: [
    { wait: 5 },
    click([4.5, 4.5]),
    { wait: 5 },
    click([1.5, 4.5]),
    awaitEvent(ARRIVED),
    click([7.8, 1.4]),
    awaitEvent(TRIGGERED),
  ],
};

export const pointAndClickProbe: GenreProbe<PointAndClickSnapshot> = {
  id: ID,
  rows: ["point-and-click", "rts"],
  pending: {
    "point-and-click": "M17 (inventory UI, cursors), M23 (dialogue)",
    rts: "M22 (minimap viewport), M24 (many units: culling, profiling), M25 (tilemaps)",
  },
  game,
  scene,
  script,
  expect: { result: "won", maxTicks: 300 },
  variants: [{ name: "gravity-sideways", settings: { gravity: [12, 0] } }],
};
