import type { Vec2 } from "@jams/engine";
import {
  createMotionBody,
  createTopDownController,
  defineGame,
  SENSOR_ENTER,
  type ActionDef,
  type EngineContext,
  type TopDownController,
} from "@jams/engine/game";
import { runPlaytest, type RapierModule } from "@jams/engine/headless";
import type { Pt, SceneDefinition } from "@jams/engine/scene";

export type RoverSnapshot = { at: Vec2; speed: number; wallAhead: number | null } | null;

const STEER: Readonly<Record<string, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const ARROW: Readonly<Record<string, string>> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
};

/** Top-down steering on whichever backend the scene loads: a motion body, a controller and a sensor goal. */
export const roverGame = defineGame<RoverSnapshot>({
  id: "rover",
  types: [],
  actions: Object.keys(STEER).map(
    (action): ActionDef => ({
      action,
      bindings: [{ device: "key", code: ARROW[action]! }],
      description: `Steer ${action}.`,
    }),
  ),
  world: { gravity: [0, 0] },
  // Motion bodies are in the engine's dynamic group, which ignores sensors unless told.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  play: {
    results: ["won"],
    movementActions: Object.keys(STEER),
    focus: (snap) => snap?.at ?? null,
    outcome: ({ events }) =>
      events.some((e) => e.type === "rover:home") ? { result: "won" } : null,
  },
  createRuntime(ctx: EngineContext) {
    const held = new Set<string>();
    let rover: TopDownController | null = null;
    let position = (): Vec2 => ({ x: 0, y: 0 });
    let id = "";
    return {
      onLoad(scene) {
        held.clear();
        const start = scene.entities.find((e) => e.id === "start");
        if (!start) return;
        const [x, y] = start.at as Pt;
        id = start.id;
        const body = createMotionBody(
          ctx,
          { id, type: start.type },
          { x, y },
          {
            shape: { type: "circle", cx: 0, cy: 0, r: 0.08 },
          },
        );
        position = () => body.position();
        rover = createTopDownController(body, { maxSpeed: 1.8, accel: 9, decel: 9 });
      },
      beforeStep(dtMs, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        const intent = { x: 0, y: 0 };
        for (const a of held) {
          intent.x += STEER[a]?.x ?? 0;
          intent.y += STEER[a]?.y ?? 0;
        }
        rover?.step(dtMs, intent);
      },
      afterStep(_dtMs, events) {
        for (const e of events)
          if (e.type === SENSOR_ENTER && e.entityId === "home" && e.other === id)
            ctx.emit({ type: "rover:home", entityId: "home", at: e.at });
      },
      snapshot() {
        if (!rover) return null;
        const at = position();
        const v = rover.velocity();
        // ctx.space answers on Rapier and on the geometry backend alike.
        const hit = ctx.space.raycast(at, { x: 1, y: 0 }, 10, { exclude: [id] });
        return {
          at,
          speed: Math.sqrt(v.x * v.x + v.y * v.y),
          wallAhead: hit ? hit.toi * 10 : null,
        };
      },
    };
  },
});

const yard = (physics: "rapier" | "none"): SceneDefinition => ({
  v: 4,
  game: "rover",
  name: "yard",
  bounds: [0, 0, 4, 3],
  settings: { physics },
  entities: [
    { id: "east", type: "solid", shape: ["box", 3.92, 1.5, 0.08, 1.5] },
    { id: "south", type: "solid", shape: ["box", 2, 2.92, 2, 0.08] },
    { id: "start", type: "marker", at: [0.4, 0.4] },
    { id: "home", type: "sensor", shape: ["box", 3.6, 2.6, 0.24, 0.24] },
  ],
});

/** Drives right into the east wall, then slides down it into the home sensor. */
export function driveHome(rapier: RapierModule | null) {
  const run = runPlaytest({
    rapier,
    game: roverGame,
    scene: yard(rapier ? "rapier" : "none"),
    script: {
      v: 2,
      steps: [
        { hold: ["right"], forMs: 2500 },
        { hold: ["right", "down"], until: { event: "rover:home" }, max: 600 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return { result: run.outcome.result, ticks: run.ticks, final: run.final };
}
