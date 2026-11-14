import { defineGame, type EngineContext } from "@jams/engine/game";
import type { SceneDefinition } from "@jams/engine/scene";

/**
 * A scout walks the ridge under a look-ahead rig. When it reaches the tower
 * the game frames the tower for a second, closer in, then hands the camera
 * back to the rig's own target.
 */
export const lookoutGame = defineGame({
  id: "lookout",
  types: [],
  actions: [],
  world: { physics: "none" },
  camera: {
    deadzone: [1, 0.6],
    lookAhead: 0.25,
    maxLead: 1.5,
    damping: 0.15,
    shake: { maxOffset: 12, maxTurn: 0.02, decay: 1.5 },
  },
  createRuntime(ctx: EngineContext) {
    let seen = false;
    return {
      onLoad() {
        seen = false;
      },
      afterStep() {
        const scout = ctx.poses.get("scout");
        if (seen || !scout || scout.x < 7) return;
        seen = true;
        ctx.present.camera.follow({ entity: "tower" });
        ctx.present.camera.zoom(1.6, { ms: 400, ease: "sineOut" });
        ctx.present.effects.flash({ color: 0xfff1c0, ms: 200, alpha: 0.4 });
        ctx.timers.after({ ms: 1000 }, () => {
          ctx.present.camera.follow(null);
          ctx.present.camera.zoom(1, { ms: 400 });
        });
      },
      snapshot: () => ({ seen }),
    };
  },
});

export const ridge: SceneDefinition = {
  v: 4,
  game: "lookout",
  name: "ridge",
  bounds: [0, 0, 12, 4],
  // The scene's camera settings win over the game's, field by field.
  settings: { camera: { damping: 0.25 } },
  entities: [
    {
      id: "scout",
      type: "marker",
      at: [1, 3],
      behaviors: {
        "camera-target": {},
        tween: { tweens: [{ to: { x: 9 }, duration: { ms: 3000 }, ease: "sineInOut" }] },
      },
    },
    { id: "tower", type: "marker", at: [10, 1.5] },
    { id: "overlook", type: "camera-region", shape: ["box", 10, 2, 2, 2], zoom: 1.4, ease: 0.6 },
  ],
};
