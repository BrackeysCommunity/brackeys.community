import { defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import { createMotionBody } from "../../motion/body";
import { createTopDownController, type TopDownController } from "../../motion/top-down";
import { SENSOR_ENTER } from "../../runtime/types";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "top-down";
/** The tag on the marker the rover starts at, and on the sensor it drives into. */
const ROVER = "rover";
const GOAL = "goal";
/** Raised when the rover enters a goal sensor. */
const ARRIVED = `${ID}:arrived`;

const TUNING = { maxSpeed: 160, accel: 800, decel: 600 };
const HALF = 6;

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
    keys: [`arrow${action}`],
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
    const held = new Set<string>();
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
        held.clear();
        goals.clear();
      },
      beforeStep(dtMs, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!rover) return;
        const intent = { x: 0, y: 0 };
        for (const action of held) {
          const d = DIRECTIONS[action];
          if (!d) continue;
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
    };
  },
});

const solid = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
});

/**
 * An L-shaped corridor 64 px wide: east along y 64–128 from the start, then
 * south along x 416–480 to a goal sensor near its foot. Every wall is an
 * axis-aligned box, so the geometry backend's sweeps are exact.
 */
const scene: SceneDefinition = {
  v: 3,
  game: ID,
  name: "top-down-probe",
  bounds: [0, 0, 512, 448],
  settings: { gravity: [0, 0], physics: "rapier" },
  entities: [
    solid("north", 248, 56, 248, 8),
    solid("east", 488, 232, 8, 184),
    solid("west-cap", 8, 96, 8, 32),
    solid("inner-south", 208, 136, 208, 8),
    solid("inner-west", 408, 272, 8, 144),
    solid("south-cap", 448, 408, 32, 8),
    { id: "start", type: "marker", at: [48, 96], tags: [ROVER] },
    { id: "goal", type: "sensor", shape: ["box", 448, 368, 24, 16], tags: [GOAL] },
  ],
};

/** Zero gravity; a top-down controller steers east, then slides south along the far wall into the goal. */
export const topDownProbe: GenreProbe<TopDownSnapshot> = {
  id: ID,
  rows: ["top-down", "racing"],
  pending: {
    "top-down": "M18 (saves), M23 (dialogue), M25 (tilemaps)",
    racing: "M15 (contact events), M16 (analog steering), M22 (look-ahead camera)",
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
    { name: "gravity-sideways", settings: { gravity: [1200, 0] } },
  ],
};
