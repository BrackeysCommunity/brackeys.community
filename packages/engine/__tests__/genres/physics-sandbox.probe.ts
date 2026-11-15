import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext, PlayState } from "../../game/types";
import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import { createDragJoint, type DragJoint } from "../../physics/drag";
import { CONTACT_START, SENSOR_ENTER, SENSOR_EXIT } from "../../runtime/types";
import { decomposeBatch } from "../../scene/decompose";
import { applyOps } from "../../scene/ops";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "physics-sandbox";
const CRATE = "crate";
const GOAL = "goal";
const BIN = "bin";
const BOOM = "boom";
const HOOK = "hook";
const POSTS = ["post-left", "post-right"] as const;
const PLANKS = ["plank-1", "plank-2", "plank-3", "plank-4"] as const;
/** m/s², down. */
const GRAVITY = 10;
/** Half a crate's side, m. */
const CRATE_H = 0.25;
/** The floor's top, m. */
const FLOOR = 7.5;
/** Where the crates are spawned, on the floor, and where each is dropped over the bin. */
const CRATES: readonly { at: Pt; drop: Pt }[] = [
  { at: [2, FLOOR - CRATE_H], drop: [13, 3] },
  { at: [3, FLOOR - CRATE_H], drop: [13.5, 3] },
  { at: [4, FLOOR - CRATE_H], drop: [14, 3] },
];
const NEEDED = 3;
/** How far the crane must have lifted its hook, m. */
const LIFT = 1;
/** The crane's boom: pivot and half length, m. */
const PIVOT: Pt = [6, 6.5];
const BOOM_HW = 0.75;
/** The bridge's deck height and plank half width, m. */
const DECK = 5;
const PLANK_HW = 0.2;

export type SandboxSnapshot = {
  /** Crate ids spawned, in order. */
  crates: string[];
  /** Crates inside the goal now. */
  inGoal: string[];
  /** `contact:start` events between a crate and anything solid, so far. */
  contacts: number;
  /** The hook's height, m (y down): the crane lifts it. */
  hook: number;
  /** The lowest the hook has been and how high it got, m. */
  hookLow: number;
  hookHigh: number;
  /** Every plank still hangs between the posts, near the deck. */
  spans: boolean;
  drags: number;
};

const crateType = defineEntityType({
  type: CRATE,
  description: "A box the pointer drags; three in the goal win.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it is spawned.") },
});

const game = defineGame<SandboxSnapshot>({
  id: ID,
  types: [crateType],
  actions: [
    {
      action: "grab",
      description: "Hold to drag a body.",
      bindings: [{ device: "pointer", button: "primary" }],
    },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  world: { physics: "rapier" },
  time: { kind: "fixed", rate: 60 },
  play: {
    results: ["won"],
    outcome({ snapshot }: PlayState<SandboxSnapshot>) {
      if (snapshot.inGoal.length < NEEDED) return null;
      // The win also proves the rest of the yard: the crane lifted, the bridge held, contacts were seen.
      if (!snapshot.spans || snapshot.contacts < NEEDED) return null;
      if (snapshot.hookLow - snapshot.hookHigh < LIFT) return null;
      return { result: "won", cause: `${NEEDED} crates in the goal`, entityId: GOAL };
    },
  },
  createRuntime(ctx: EngineContext) {
    const crates: string[] = [];
    const inGoal = new Set<string>();
    let contacts = 0;
    let drags = 0;
    let drag: DragJoint | null = null;
    let hookLow = -Infinity;
    let hookHigh = Infinity;
    const y = (id: string) => ctx.poses.get(id)?.y ?? 0;
    const spans = () =>
      PLANKS.every((p) => {
        const at = ctx.poses.get(p);
        const [l, r] = POSTS.map((q) => ctx.poses.get(q)?.x ?? 0) as [number, number];
        return !!at && at.x > l && at.x < r && Math.abs(at.y - DECK) < 0.5;
      });

    return {
      onLoad() {
        for (const { at } of CRATES) {
          const { id } = ctx.spawn({
            type: CRATE,
            at,
            behaviors: {
              collider: { shape: ["box", 0, 0, CRATE_H, CRATE_H] },
              body: { kind: "dynamic", fixedRotation: true },
            },
          });
          crates.push(id);
        }
        ctx.contacts.watch({ type: CRATE });
      },
      onUnload() {
        drag?.release();
        drag = null;
      },
      beforeStep() {
        const p = ctx.input.pointer();
        if (ctx.input.pressed("grab") && p) {
          const hit = ctx.space.pointAt(p).find((h) => crates.includes(h.tag.entityId));
          if (hit) {
            drag = createDragJoint(ctx, hit.tag.entityId, p, { maxForce: 40 });
            drags++;
          }
        } else if (ctx.input.released("grab")) {
          drag?.release();
          drag = null;
        } else if (drag && p) drag.update(p);
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type === CONTACT_START && crates.includes(e.entityId ?? "")) contacts++;
          if (e.entityId !== GOAL || !e.other || !crates.includes(e.other)) continue;
          if (e.type === SENSOR_ENTER) inGoal.add(e.other);
          if (e.type === SENSOR_EXIT) inGoal.delete(e.other);
        }
        const h = y(HOOK);
        hookLow = Math.max(hookLow, h);
        hookHigh = Math.min(hookHigh, h);
      },
      snapshot() {
        return {
          crates: [...crates],
          inGoal: crates.filter((c) => inGoal.has(c)),
          contacts,
          hook: y(HOOK),
          hookLow,
          hookHigh,
          spans: spans(),
          drags,
        };
      },
      restore(s) {
        crates.splice(0, crates.length, ...s.crates);
        inGoal.clear();
        for (const c of s.inGoal) inGoal.add(c);
        contacts = s.contacts;
        drags = s.drags;
        hookLow = s.hookLow;
        hookHigh = s.hookHigh;
      },
    };
  },
});

const dynamicBox = (id: string, at: Pt, hw: number, hh: number, extra: object = {}): EntityDef =>
  ({
    id,
    type: "marker",
    at,
    behaviors: {
      collider: { shape: ["box", 0, 0, hw, hh] },
      body: { kind: "dynamic" },
      ...extra,
    },
  }) as EntityDef;

/** Rope links from the left post across the planks to the right post, each end at a plank's edge. */
const bridge: EntityDef[] = [
  ...PLANKS.map((id, i) =>
    dynamicBox(id, [9 + i * 0.5, DECK], PLANK_HW, 0.05, {
      joint:
        i === 0
          ? { kind: "rope", to: POSTS[0], anchorA: [-PLANK_HW, 0], anchorB: [0, 0], length: 0.35 }
          : {
              kind: "rope",
              to: PLANKS[i - 1],
              anchorA: [-PLANK_HW, 0],
              anchorB: [PLANK_HW, 0],
              length: 0.12,
            },
    }),
  ),
  {
    id: POSTS[0],
    type: "marker",
    at: [8.5, DECK],
    behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] }, body: { kind: "static" } },
  } as EntityDef,
  {
    id: POSTS[1],
    type: "marker",
    at: [11, DECK],
    behaviors: {
      collider: { shape: ["box", 0, 0, 0.1, 0.1] },
      body: { kind: "static" },
      joint: { kind: "rope", to: PLANKS[3], anchorA: [0, 0], anchorB: [PLANK_HW, 0], length: 0.35 },
    },
  } as EntityDef,
];

/**
 * A boom hinged on the crane's base whose motor swings it up against its
 * limit, and a hook hinged free at the boom's tip, which it lifts.
 */
const crane: EntityDef[] = [
  { id: "crane-base", type: "solid", shape: ["box", PIVOT[0], 7, 0.2, 0.5] },
  dynamicBox(BOOM, [PIVOT[0] + BOOM_HW, PIVOT[1]], BOOM_HW, 0.08, {
    joint: {
      kind: "revolute",
      to: "crane-base",
      anchorA: [-BOOM_HW, 0],
      limits: [-1, 0],
      motor: { velocity: -1, maxForce: 30 },
    },
  }),
  dynamicBox(HOOK, [PIVOT[0] + 2 * BOOM_HW, PIVOT[1] + 0.3], 0.1, 0.1, {
    joint: { kind: "revolute", to: BOOM, anchorA: [0, -0.3] },
  }),
];

/** The goal's bin: one concave U, open at the top, which the scene splits into convex pieces before it loads. */
const BIN_HULL: readonly Pt[] = [
  [12, 5.5],
  [12.2, 5.5],
  [12.2, 7.3],
  [14.8, 7.3],
  [14.8, 5.5],
  [15, 5.5],
  [15, FLOOR],
  [12, FLOOR],
];

const raw: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "physics-sandbox-probe",
  bounds: [0, 0, 16, 8],
  settings: { gravity: [0, GRAVITY], physics: "rapier" },
  entities: [
    { id: "floor", type: "solid", shape: ["box", 8, FLOOR + 0.25, 8, 0.25] },
    { id: BIN, type: "solid", shape: ["poly", ...BIN_HULL.flat()] },
    { id: GOAL, type: "sensor", shape: ["box", 13.5, 6.6, 1.2, 0.6] },
    ...crane,
    ...bridge,
  ] as EntityDef[],
};

function splitBin(def: SceneDefinition): SceneDefinition {
  const registry = createRegistry(game);
  const made = decomposeBatch(def, BIN, registry);
  if (!made.ok) throw new Error(made.issue.message);
  const applied = applyOps(def, made.batch, registry);
  if (!applied.ok) throw new Error(JSON.stringify(applied));
  return applied.def;
}

const scene = splitBin(raw);

/** Picks a crate up, carries it over the bin and lets go. */
const carry = ({ at, drop }: (typeof CRATES)[number]): InputScriptStepV2[] => [
  { pointer: { at, press: "primary" }, for: 1 },
  { pointer: { at, drag: [at[0], drop[1]] }, for: 30 },
  { pointer: { at: [at[0], drop[1]], drag: drop }, for: 60 },
  { pointer: { at: drop }, for: 30 },
  { pointer: { at: drop, release: "primary" }, for: 2 },
  { wait: 60 },
];

const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  maxTicks: 900,
  steps: [{ wait: 20 }, ...CRATES.flatMap(carry), { wait: 60 }],
};

/**
 * Rapier under the probe's own gravity: a motorised crane of revolute
 * joints lifts its hook, a rope bridge spans two posts, and a concave bin
 * is split into convex pieces before load. Three crates are spawned at
 * runtime and a recorded pointer drags each into the bin's goal sensor;
 * their contacts are counted. Joints need Rapier, so there's no
 * physics-free variant, and world saves of a Rapier scene aren't taken.
 */
export const physicsSandboxProbe: GenreProbe<SandboxSnapshot> = {
  id: ID,
  rows: ["physics-sandbox"],
  game,
  scene,
  script,
  expect: { result: "won", maxTicks: 900 },
};
