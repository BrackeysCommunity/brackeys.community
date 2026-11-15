import { defineGame, type EngineContext, type JointSystem } from "@jams/engine/game";
import { runPlaytest, type RapierModule } from "@jams/engine/headless";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "@jams/engine/scene";

export type YardSnapshot = {
  /** The gate's angle, rad: its motor drives it open until the high limit stops it. */
  gate: number;
  /** How far the shutter has slid down its rail, m, held by the rail's limits. */
  shutter: number;
  /** The lamp's distance from the beam, m: never past the rope's 1 m. */
  lamp: number;
  /** The sign's offset from the gate's leaf, m: a weld keeps it. */
  sign: number;
  /** The bob's distance from the beam, m: the spring pulls it toward 0.5 m. */
  bob: number;
  /** Which entities' joints exist right now. */
  joined: string[];
};

const JOINTED = ["gate", "shutter", "lamp", "sign", "bob"];

export const yardGame = defineGame<YardSnapshot>({
  id: "joint-yard",
  types: [],
  actions: [],
  createRuntime(ctx: EngineContext) {
    const at = (id: string) => ctx.poses.get(id) ?? { x: 0, y: 0, rot: 0 };
    const apart = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    return {
      snapshot: () => ({
        gate: at("gate").rot,
        shutter: at("shutter").y - 1,
        lamp: apart("lamp", "beam"),
        sign: apart("sign", "gate"),
        bob: apart("bob", "beam"),
        joined: JOINTED.filter((id) => ctx.behavior<JointSystem>("joint")?.joined(id)),
      }),
    };
  },
});

const box = (
  id: string,
  at: [number, number],
  kind: "dynamic" | "static",
  joint?: Record<string, unknown>,
): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.2, 0.2] },
    body: { kind },
    ...(joint ? { joint } : {}),
  },
});

export const yard: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "joint-yard",
  name: "yard",
  bounds: [-4, -4, 8, 6],
  settings: { physics: "rapier", gravity: [0, 9.8] },
  entities: [
    box("beam", [0, 0], "static"),
    // A hinge: anchors are metres from each body's own pose. The gate turns
    // about the beam's corner, its motor driving it at 1 rad/s with at most
    // 40 N·m, until the high limit (1 rad) stops it.
    box("gate", [1, 0], "dynamic", {
      kind: "revolute",
      to: "beam",
      anchorA: [-1, 0],
      anchorB: [0, 0],
      limits: [0, 1],
      motor: { velocity: 1, maxForce: 40 },
    }),
    // A slider down the beam's frame, falling under gravity to 0.5 m of travel.
    box("shutter", [3, 1], "dynamic", {
      kind: "prismatic",
      to: "beam",
      axis: [0, 1],
      limits: [0, 0.5],
    }),
    // Without anchorB the other end holds the point under anchorA, so the
    // rope and the spring name the beam's centre to measure from it.
    box("lamp", [-1, 1], "dynamic", { kind: "rope", to: "beam", anchorB: [0, 0], length: 1 }),
    box("sign", [1.5, 0], "dynamic", { kind: "weld", to: "gate" }),
    box("bob", [-2, 0], "dynamic", {
      kind: "spring",
      to: "beam",
      anchorB: [0, 0],
      length: 0.5,
      stiffness: 400,
      damping: 20,
    }),
  ],
};

/** Three seconds in the yard. */
export function swingGate(rapier: RapierModule) {
  const run = runPlaytest<YardSnapshot>({
    rapier,
    game: yardGame,
    scene: yard,
    script: { v: 2, steps: [{ wait: 180 }] },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run.final!;
}
