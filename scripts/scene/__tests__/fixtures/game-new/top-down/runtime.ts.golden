import type { Vec2 } from "@jams/engine";
import {
  createMotionBody,
  createTopDownController,
  SENSOR_ENTER,
  type EngineContext,
  type GameRuntime,
  type MotionBody,
  type TopDownController,
} from "@jams/engine/game";

import { GOAL_TAG, HERO, HERO_SIZE, REACHED, type Slice, type Snapshot } from "./types";

/** The hero's top speed, m/s, and how fast it gets there and stops, m/s². */
const TUNING = { maxSpeed: 3, accel: 20, decel: 16 };

/** Steers the hero with `move` and raises `REACHED` when it enters a goal. */
export function createRuntime(ctx: EngineContext): GameRuntime<Snapshot> {
  let body: MotionBody | null = null;
  let controller: TopDownController | null = null;
  let heroId: string | null = null;
  let goals = new Set<string>();
  let intent: Vec2 = { x: 0, y: 0 };
  let reached = false;
  let slice: Slice = { reached };

  return {
    onLoad(scene) {
      goals = new Set(
        scene.entities
          .filter(
            (e) => e.type === "sensor" && (e.tags as string[] | undefined)?.includes(GOAL_TAG),
          )
          .map((e) => e.id),
      );
      const start = scene.entities.find((e) => e.type === HERO);
      if (!start) return;
      const [x, y] = start.at as [number, number];
      const half = (typeof start.size === "number" ? start.size : HERO_SIZE) / 2;
      const shape = { type: "box" as const, cx: 0, cy: 0, hw: half, hh: half, rotDeg: 0 };
      body = createMotionBody(ctx, start, ctx.play?.at ?? { x, y }, { shape });
      controller = createTopDownController(body, TUNING);
      heroId = start.id;
    },
    onUnload() {
      body = null;
      controller = null;
      heroId = null;
      goals.clear();
      intent = { x: 0, y: 0 };
      reached = false;
    },
    beforeStep(dtMs, actions) {
      for (const a of actions) {
        if (a.action === "move") intent = a.pressed ? { x: a.x ?? 0, y: a.y ?? 0 } : { x: 0, y: 0 };
      }
      controller?.step(dtMs, reached ? { x: 0, y: 0 } : intent);
    },
    afterStep(_dtMs, events) {
      for (const e of events) {
        if (reached || e.type !== SENSOR_ENTER || e.other !== heroId) continue;
        if (e.entityId === undefined || !goals.has(e.entityId)) continue;
        reached = true;
        ctx.emit({ type: REACHED, entityId: e.entityId, other: heroId, at: e.at });
      }
    },
    // An event clock keeps ticking while the hero moves.
    busy() {
      const v = controller?.velocity();
      return intent.x !== 0 || intent.y !== 0 || (v !== undefined && (v.x !== 0 || v.y !== 0));
    },
    cameraTarget: () => body?.position() ?? null,
    snapshot: () => ({ at: body?.position() ?? null, reached }),
    storeSlice() {
      if (slice.reached !== reached) slice = { reached };
      return slice;
    },
  };
}
