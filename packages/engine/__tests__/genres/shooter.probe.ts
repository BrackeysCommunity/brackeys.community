import { defineEntityType, defineGame } from "../../game/define";
import { bodyShapeField, PathSchema, pointField } from "../../game/fields";
import { runtimeId } from "../../game/runtime-ids";
import type { EngineContext } from "../../game/types";
import { CONTACT_START, ENTITY_DESTROYED, type StepEvent } from "../../runtime/types";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "shooter";
const TURRET = "turret";
const BULLET = "bullet";

/** Bullets the turret fires in a run; it fires one a tick while `fire` is held. */
export const SHOTS = 1000;
/** m/s along the bullet's path: 0.1 m a tick at 60 Hz, under the walls' 0.16 m thickness. */
const SPEED = 6;
/** Metres, well past the walls, so a bullet always meets one before its path turns back. */
const RANGE = 20;
/** Long enough to cross the arena; a bullet that outlives it missed every wall. */
const LIFETIME_MS = 1500;
/** The bullet's radius, m. */
const RADIUS = 0.03;

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
  fields: { at: pointField("The muzzle, in world metres.") },
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
      keys: [`Arrow${action.charAt(4).toUpperCase()}${action.slice(5)}`],
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
      for (const [action, d] of Object.entries(AIM)) {
        if (!ctx.input.held(action)) continue;
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
        live.clear();
        hits.clear();
      },
      beforeStep() {
        if (ctx.input.held("fire")) fire();
      },
      snapshot() {
        return { ...snap, live: live.size };
      },
      // The bullets come back with the world save; between ticks none is hit and not yet destroyed.
      restore(s) {
        snap = { ...fresh(), fired: s.fired, hit: s.hit, expired: s.expired, ids: s.ids };
        snap.misnamed = s.misnamed;
        live.clear();
        for (const id of ctx.query.byType(BULLET)) live.add(id);
        hits.clear();
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
 * A closed 6.4 m arena with 0.16 m walls, a pillar in the north-east
 * quarter that the diagonal stream meets first, and the turret off-centre
 * so each side's bullets travel a different distance.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "shooter-probe",
  bounds: [0, 0, 6.4, 6.4],
  settings: { gravity: [0, 0], physics: "rapier" },
  entities: [
    wall("north", 3.2, 0.08, 3.2, 0.08),
    wall("south", 3.2, 6.32, 3.2, 0.08),
    wall("west", 0.08, 3.2, 0.08, 3.04),
    wall("east", 6.32, 3.2, 0.08, 3.04),
    wall("pillar", 4.8, 1.4, 0.24, 0.24),
    { id: "muzzle", type: TURRET, at: [2.8, 3] },
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
    "twin-stick": "M22 (particles, screen shake)",
    "endless-runner": "M19 (an installable PWA), M22 (parallax)",
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
  variants: [
    { name: "physics-none", settings: { physics: "none" } },
    // Mid-stream, bullets in flight; a world save needs the geometry backend.
    { name: "saved-physics-none", settings: { physics: "none" }, saveAt: 300 },
  ],
  timeoutMs: 30_000,
};
