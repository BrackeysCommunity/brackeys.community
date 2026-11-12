import { defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import { createMotionBody } from "../../motion/body";
import { createTopDownController, type TopDownController } from "../../motion/top-down";
import { SENSOR_ENTER } from "../../runtime/types";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "top-down";
/** The tag on the marker the rover starts at, and on the sensor it drives into. */
const ROVER = "rover";
const GOAL = "goal";
/** Raised when the rover enters a goal sensor. */
const ARRIVED = `${ID}:arrived`;

/** m/s and m/s². */
const TUNING = { maxSpeed: 1.6, accel: 8, decel: 6 };
/** The rover's half width, m. */
const HALF = 0.06;

export type TopDownSnapshot = { position: Vec2; velocity: Vec2 } | null;

const DIRECTIONS: Readonly<Record<string, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const game = defineGame<TopDownSnapshot>({
  id: ID,
  types: [],
  actions: Object.keys(DIRECTIONS).map((action) => ({
    action,
    keys: [`Arrow${action.charAt(0).toUpperCase()}${action.slice(1)}`],
    description: `Steer ${action}.`,
  })),
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  time: { kind: "fixed" },
  play: {
    focus: (snap) => snap?.position ?? null,
    movementActions: Object.keys(DIRECTIONS),
    results: ["won"],
    outcome({ events }) {
      const goal = events.find((e) => e.type === ARRIVED);
      return goal ? { result: "won", cause: "reached the goal", entityId: goal.entityId } : null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let rover: TopDownController | null = null;
    let roverId: string | null = null;
    let position: () => Vec2 = () => ({ x: 0, y: 0 });
    let goals = new Set<string>();

    return {
      onLoad(scene) {
        const tagged = (type: string, tag: string) =>
          scene.entities.filter(
            (e) => e.type === type && (e.tags as string[] | undefined)?.includes(tag),
          );
        goals = new Set(tagged("sensor", GOAL).map((e) => e.id));
        const start = tagged("marker", ROVER)[0];
        if (!start) return;
        const [x, y] = start.at as Pt;
        const at = ctx.play?.at ?? { x, y };
        const body = createMotionBody(ctx, { id: start.id, type: start.type }, at, {
          shape: { type: "box", cx: 0, cy: 0, hw: HALF, hh: HALF, rotDeg: 0 },
        });
        roverId = start.id;
        position = () => body.position();
        rover = createTopDownController(body, TUNING);
      },
      onUnload() {
        rover = null;
        roverId = null;
        goals.clear();
      },
      beforeStep(dtMs) {
        if (!rover) return;
        const intent = { x: 0, y: 0 };
        for (const [action, d] of Object.entries(DIRECTIONS)) {
          if (!ctx.input.held(action)) continue;
          intent.x += d.x;
          intent.y += d.y;
        }
        rover.step(dtMs, intent);
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type === SENSOR_ENTER && e.other === roverId && goals.has(e.entityId!)) {
            ctx.emit({ type: ARRIVED, entityId: e.entityId, at: e.at });
          }
        }
      },
      snapshot() {
        if (!rover) return null;
        return { position: position(), velocity: rover.velocity() };
      },
      // The rover's body comes back with the world save, and held directions with the input.
      restore() {},
    };
  },
});

const solid = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
});

/**
 * An L-shaped corridor 0.64 m wide: east along y 0.64–1.28 m from the start,
 * then south along x 4.16–4.8 m to a goal sensor near its foot. Every wall
 * is an axis-aligned box, so the geometry backend's sweeps are exact.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "top-down-probe",
  bounds: [0, 0, 5.12, 4.48],
  settings: { gravity: [0, 0], physics: "rapier" },
  entities: [
    solid("north", 2.48, 0.56, 2.48, 0.08),
    solid("east", 4.88, 2.32, 0.08, 1.84),
    solid("west-cap", 0.08, 0.96, 0.08, 0.32),
    solid("inner-south", 2.08, 1.36, 2.08, 0.08),
    solid("inner-west", 4.08, 2.72, 0.08, 1.44),
    solid("south-cap", 4.48, 4.08, 0.32, 0.08),
    { id: "start", type: "marker", at: [0.48, 0.96], tags: [ROVER] },
    { id: "goal", type: "sensor", shape: ["box", 4.48, 3.68, 0.24, 0.16], tags: [GOAL] },
  ],
};

/** Zero gravity; a top-down controller steers east, then slides south along the far wall into the goal. */
export const topDownProbe: GenreProbe<TopDownSnapshot> = {
  id: ID,
  rows: ["top-down", "racing"],
  pending: {
    "top-down": "M23 (dialogue), M25 (tilemaps)",
    racing: "M22 (look-ahead camera)",
  },
  game,
  scene,
  script: {
    v: 1,
    scene: scene.name,
    maxTicks: 900,
    steps: [
      { hold: ["right"], for: 150 },
      { hold: ["right", "down"], until: { event: ARRIVED }, max: 400 },
    ],
  },
  expect: { result: "won", maxTicks: 900 },
  variants: [
    { name: "physics-none", settings: { physics: "none" } },
    { name: "gravity-sideways", settings: { gravity: [12, 0] } },
    // Turning the corner; a world save needs the geometry backend.
    { name: "saved-physics-none", settings: { physics: "none" }, saveAt: 200 },
  ],
};
