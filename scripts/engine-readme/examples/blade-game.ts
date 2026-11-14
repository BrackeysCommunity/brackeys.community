import { ANIM_FRAME, defineGame, overlapFrameShapes, type EngineContext } from "@jams/engine/game";
import { memoryRuntimeView, type AssetInfo, type ProjectRuntimeView } from "@jams/engine/headless";
import type { AnimationFile } from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";

/** The sheet's meta as the project reads it from the atlas: frames, durations and tags. */
export const bladeSheet: AssetInfo = {
  id: "blade-sheet",
  kind: "atlas",
  frames: ["rest-0", "rest-1", "cut-0", "cut-1", "cut-2", "post-0"],
  durations: [150, 150, null, null, null, null],
  tags: [{ name: "rest", from: 0, to: 1, direction: "forward" }],
};

/** `rest` is the sheet's tag as it is; `cut` and `stand` are written frame by frame. */
export const bladeMoves: AnimationFile = {
  kind: "animation",
  v: 1,
  atlas: "blade-sheet",
  clips: [
    { name: "rest", tag: "rest" },
    {
      name: "cut",
      loop: "once",
      next: "rest",
      frames: [
        { frame: "cut-0", ms: 50 },
        {
          frame: "cut-1",
          ms: 50,
          events: ["swish"],
          shapes: { hit: [["box", 0.3, 0, 0.15, 0.05]] },
        },
        { frame: "cut-2", ms: 100 },
      ],
    },
    {
      name: "stand",
      frames: [{ frame: "post-0", shapes: { hurt: [["box", 0, 0, 0.1, 0.3]] } }],
    },
  ],
};

/** The docs a run reads, and the atlas meta behind them; no image is ever decoded. */
export const bladeProject: ProjectRuntimeView = {
  ...memoryRuntimeView({ docs: { animation: { "blade-moves": bladeMoves } } }),
  asset: (id) => (id === bladeSheet.id ? bladeSheet : undefined),
};

const animated = (id: string, x: number, clip: string) => ({
  id,
  type: "marker",
  at: [x, 1] as [number, number],
  behaviors: {
    sprite: { asset: "blade-sheet", frame: clip === "stand" ? "post-0" : "rest-0" },
    anim: { source: "blade-moves", clip },
  },
});

export const practice: SceneDefinition = {
  v: 4,
  game: "blade",
  name: "practice",
  bounds: [0, 0, 4, 2],
  settings: { physics: "none" },
  entities: [animated("blade", 1, "rest"), animated("post", 1.4, "stand")],
};

export type BladeSnapshot = { swishes: number; hits: number; clip: string | null };

/**
 * `cut` swings the blade and `back` steps it away from the post; each swish
 * that reaches the post's hurt box shakes the camera, stops time and sparks.
 */
export const bladeGame = defineGame<BladeSnapshot>({
  id: "blade",
  types: [],
  actions: [],
  world: { physics: "none" },
  commands: {
    cut: { description: "Swing the blade." },
    back: { description: "Step the blade half a metre away from the post." },
  },
  createRuntime(ctx: EngineContext) {
    let swishes = 0;
    let hits = 0;
    return {
      onLoad() {
        swishes = 0;
        hits = 0;
        ctx.events.on(ANIM_FRAME, (e) => {
          const { event } = e.data as { event: string };
          if (e.entityId !== "blade" || event !== "swish") return;
          swishes++;
          if (!overlapFrameShapes(ctx, "blade", "hit", "post", "hurt")) return;
          hits++;
          const at = ctx.poses.get("post");
          ctx.present.camera.shake(0.4);
          ctx.present.effects.hitStop(60);
          if (at) ctx.present.effects.burst("sparks", { x: at.x, y: at.y });
        });
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          if (c.name === "cut") ctx.anim.play("blade", "cut", { restart: true });
          if (c.name === "back") ctx.tweens.to("blade", { to: { x: 0.5 }, duration: 6 });
        }
      },
      snapshot: () => ({ swishes, hits, clip: ctx.anim.state("blade")?.clip ?? null }),
    };
  },
});
