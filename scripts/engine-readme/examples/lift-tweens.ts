import {
  createRegistry,
  defineGame,
  EngineError,
  ease,
  type EngineContext,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { expandScene, type SceneDefinition } from "@jams/engine/scene";

export const ARRIVED = "lift:arrived";

export type LiftSnapshot = { cabY: number; arrivedAt: number | null; running: number };

/** `raise` eases the cab up a floor; the beacon turns forever from its `tween` block. */
export const liftGame = defineGame<LiftSnapshot>({
  id: "lift",
  types: [],
  actions: [],
  world: { physics: "none" },
  commands: { raise: { description: "Send the cab up one floor." } },
  createRuntime(ctx: EngineContext) {
    let arrivedAt: number | null = null;
    return {
      onLoad() {
        arrivedAt = null;
        ctx.events.on(ARRIVED, (e) => void (arrivedAt = e.tick));
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          if (c.name !== "raise") continue;
          const y = ctx.poses.get("cab")?.y ?? 0;
          ctx.tweens.to("cab", {
            to: { y: y - 1 },
            duration: { ms: 500 },
            ease: "quadOut",
            key: "move",
            emit: { type: ARRIVED },
          });
        }
      },
      snapshot: () => ({
        cabY: ctx.poses.get("cab")?.y ?? 0,
        arrivedAt,
        running: ctx.tweens.size,
      }),
    };
  },
});

export const shaft: SceneDefinition = {
  v: 4,
  game: "lift",
  name: "shaft",
  bounds: [0, 0, 2, 4],
  entities: [
    { id: "cab", type: "marker", at: [1, 3] },
    {
      id: "beacon",
      type: "marker",
      at: [1, 0.2],
      behaviors: { tween: { tweens: [{ to: { rot: 6.2832 }, duration: 120, repeat: -1 }] } },
    },
  ],
};

/** Raises the cab, runs past its arrival, then asks a sprite-less marker to fade. */
export function rideUp() {
  const registry = createRegistry(liftGame);
  const rt = createHeadlessRuntime({
    game: liftGame,
    registry,
    scene: expandScene(shaft, registry),
  });
  rt.step(rt.ctx.time.tickMs, [], [{ name: "raise" }]);
  for (let i = 0; i < 40; i++) rt.step(rt.ctx.time.tickMs, []);
  const snapshot = rt.game?.snapshot?.() as LiftSnapshot;
  let refused: string | null = null;
  try {
    rt.ctx.tweens.to("cab", { to: { alpha: 0.5 }, duration: 10 });
  } catch (err) {
    if (err instanceof EngineError) refused = err.code;
  }
  rt.destroy();
  return { ...snapshot, refused, halfway: ease("quadOut", 0.5) };
}
