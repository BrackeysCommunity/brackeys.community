import { defineEntityType, defineGame } from "../../game/define";
import { bodyShapeField, PathSchema, pointField } from "../../game/fields";
import { runtimeId } from "../../game/runtime-ids";
import type { EngineContext } from "../../game/types";
import { CONTACT_START, ENTITY_DESTROYED, type StepEvent } from "../../runtime/types";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "shooter";
const TURRET = "turret";
const BULLET = "bullet";

/** Bullets the turret fires in a run; it fires one a tick while `fire` is held. */
export const SHOTS = 1000;
/** px/s along the bullet's path: 10 px a tick at 60 Hz, under the walls' 16 px thickness. */
const SPEED = 600;
/** Well past the walls, so a bullet always meets one before its path turns back. */
const RANGE = 2000;
/** Long enough to cross the arena; a bullet that outlives it missed every wall. */
const LIFETIME_MS = 1500;
const RADIUS = 3;

const AIM: Readonly<Record<string, Pt>> = {
  "aim-left": [-1, 0],
  "aim-right": [1, 0],
  "aim-up": [0, -1],
  "aim-down": [0, 1],
};

export type ShooterSnapshot = {
  fired: number;
  /** Bullets destroyed by a wall contact. */
  hit: number;
  /** Bullets their lifetime destroyed instead. */
  expired: number;
  live: number;
  /**
   * An FNV-1a hash of the destroyed ids in order. The report caps its events,
   * so this is what puts all thousand ids into the recording's end digest.
   */
  ids: number;
  /** The first spawn whose id wasn't the next `bullet#<n>`, if any. */
  misnamed: string | null;
};

function fnv(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const turret = defineEntityType({
  type: TURRET,
  description: "Where bullets are fired from.",
  base: "marker",
  fields: { at: pointField("The muzzle, absolute world px.") },
  ascii: "T",
});

const bullet = defineEntityType({
  type: BULLET,
  description: "A projectile riding a straight path away from its turret.",
  base: "follower",
  spawnOnly: true,
  fields: {
    shape: bodyShapeField("The bullet's collider, centred on its path point."),
    path: PathSchema,
  },
});

const game = defineGame<ShooterSnapshot>({
  id: ID,
  types: [turret, bullet],
  actions: [
    { action: "fire", keys: [" "], description: "Fire one bullet a tick." },
    ...Object.keys(AIM).map((action) => ({
      action,
      keys: [`arrow${action.slice(4)}`],
      description: `Aim ${action.slice(4)}.`,
    })),
  ],
  time: { kind: "fixed" },
  play: {
    results: ["won", "lost"],
    outcome({ snapshot: s }) {
      if (s.misnamed) return { result: "lost", cause: "a bullet got an unexpected id" };
      if (s.expired > 0) return { result: "lost", cause: "a bullet missed every wall" };
      if (s.fired === SHOTS && s.live === 0 && s.hit === SHOTS) {
        return { result: "won", cause: "every bullet met a wall" };
      }
      return null;
    },
  },
  createRuntime(ctx: EngineContext) {
    const held = new Set<string>();
    const live = new Set<string>();
    const hits = new Set<string>();
    let muzzle: Pt | null = null;
    let snap: ShooterSnapshot = fresh();

    function fresh(): ShooterSnapshot {
      return { fired: 0, hit: 0, expired: 0, live: 0, ids: 0x811c9dc5, misnamed: null };
    }

    function fire() {
      if (!muzzle || snap.fired >= SHOTS) return;
      let dx = 0;
      let dy = 0;
      for (const action of held) {
        const d = AIM[action];
        if (!d) continue;
        dx += d[0];
        dy += d[1];
      }
      if (dx === 0 && dy === 0) return;
      const [x, y] = muzzle;
      const { id } = ctx.spawn({
        type: BULLET,
        shape: ["circle", 0, 0, RADIUS],
        path: {
          pts: [
            [x, y],
            [x + dx * RANGE, y + dy * RANGE],
          ],
          mode: "ping_pong",
          speed: SPEED,
        },
        behaviors: { lifetime: { ms: LIFETIME_MS } },
      });
      snap.fired++;
      if (id !== runtimeId(BULLET, snap.fired)) snap.misnamed ??= id;
      live.add(id);
    }

    return {
      onLoad(scene) {
        held.clear();
        live.clear();
        hits.clear();
        snap = fresh();
        const at = scene.entities.find((e) => e.type === TURRET)?.at as Pt | undefined;
        muzzle = at ?? null;
        ctx.contacts.watch({ type: BULLET }, { type: "solid" });
        ctx.events.on(CONTACT_START, (e: StepEvent) => {
          if (!e.entityId || hits.has(e.entityId)) return;
          hits.add(e.entityId);
          ctx.destroy(e.entityId);
        });
        ctx.events.on(ENTITY_DESTROYED, (e: StepEvent) => {
          const id = e.entityId;
          if (!id || !live.delete(id)) return;
          if (hits.delete(id)) snap.hit++;
          else snap.expired++;
          snap.ids = fnv(snap.ids, id);
        });
      },
      onUnload() {
        muzzle = null;
        held.clear();
        live.clear();
        hits.clear();
      },
      beforeStep(_dtMs, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (held.has("fire")) fire();
      },
      snapshot() {
        return { ...snap, live: live.size };
      },
    };
  },
});

const wall = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
});

/**
 * A closed 640 px arena with 16 px walls, a pillar in the north-east
 * quarter that the diagonal stream meets first, and the turret off-centre
 * so each side's bullets travel a different distance.
 */
const scene: SceneDefinition = {
  v: 3,
  game: ID,
  name: "shooter-probe",
  bounds: [0, 0, 640, 640],
  settings: { gravity: [0, 0], physics: "rapier" },
  entities: [
    wall("north", 320, 8, 320, 8),
    wall("south", 320, 632, 320, 8),
    wall("west", 8, 320, 8, 304),
    wall("east", 632, 320, 8, 304),
    wall("pillar", 480, 140, 24, 24),
    { id: "muzzle", type: TURRET, at: [280, 300] },
  ],
};

/**
 * Zero gravity, twin-stick aim: a turret fires a thousand bullets in five
 * streams, each one spawned at runtime with a lifetime and destroyed by its
 * first wall contact. It wins only when the ids spawned were exactly
 * `bullet#1` to `bullet#1000` and each was destroyed by a wall; the destroyed
 * ids' hash is in the snapshot, so the replay check proves both runs name
 * the same ids in the same order.
 */
export const shooterProbe: GenreProbe<ShooterSnapshot> = {
  id: ID,
  rows: ["twin-stick", "endless-runner", "tower-defense"],
  pending: {
    "twin-stick": "M16 (analog sticks, pointer aim), M22 (particles, screen shake)",
    "endless-runner": "M16 (touch controls), M19 (an installable PWA), M22 (parallax)",
    "tower-defense": "M17 (build UI)",
  },
  game,
  scene,
  script: {
    v: 1,
    scene: scene.name,
    maxTicks: 1300,
    steps: [
      { hold: ["fire", "aim-right"], for: 200 },
      { hold: ["fire", "aim-down"], for: 200 },
      { hold: ["fire", "aim-left"], for: 200 },
      { hold: ["fire", "aim-up"], for: 200 },
      { hold: ["fire", "aim-up", "aim-right"], for: 200 },
      { hold: [], until: { count: { type: BULLET, max: 0 } }, max: 200 },
    ],
  },
  expect: { result: "won", maxTicks: 1300 },
  variants: [{ name: "physics-none", settings: { physics: "none" } }],
  timeoutMs: 30_000,
};
