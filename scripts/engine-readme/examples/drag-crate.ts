import { createDragJoint, defineGame, type DragJoint, type EngineContext } from "@jams/engine/game";
import { runPlaytest, type InputScriptV2, type RapierModule } from "@jams/engine/headless";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "@jams/engine/scene";

export type DragSnapshot = { crate: { x: number; y: number }; dragging: boolean };

/** Holding the primary button over a body drags it; letting go drops it. */
export const dragGame = defineGame<DragSnapshot>({
  id: "drag-crate",
  types: [],
  actions: [
    {
      action: "grab",
      description: "Hold to drag what's under the pointer.",
      bindings: [{ device: "pointer", button: "primary" }],
    },
  ],
  createRuntime(ctx: EngineContext) {
    let drag: DragJoint | null = null;
    return {
      onUnload() {
        drag?.release();
        drag = null;
      },
      beforeStep() {
        const p = ctx.input.pointer();
        if (ctx.input.pressed("grab") && p) {
          const hit = ctx.space.pointAt(p)[0];
          // A pull of at most 20 N: the spring never stretches past 20 / 200 = 0.1 m.
          if (hit) drag = createDragJoint(ctx, hit.tag.entityId, p, { maxForce: 20 });
        } else if (ctx.input.released("grab")) {
          drag?.release();
          drag = null;
        } else if (p) drag?.update(p);
      },
      snapshot() {
        const at = ctx.poses.get("crate");
        return { crate: { x: at?.x ?? 0, y: at?.y ?? 0 }, dragging: drag !== null };
      },
    };
  },
});

const floor: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "drag-crate",
  name: "floor",
  bounds: [-5, -5, 5, 5],
  settings: { physics: "rapier", gravity: [0, 0] },
  entities: [
    {
      id: "crate",
      type: "marker",
      at: [0, 0],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: { kind: "dynamic", fixedRotation: true },
      },
    },
  ],
};

/** Press on the crate, drag it 2 m right, hold, then let go: recorded input, so it replays. */
export const dragRight: InputScriptV2 = {
  v: 2,
  steps: [
    { pointer: { at: [0, 0], press: "primary" }, for: 1 },
    { pointer: { at: [0, 0], drag: [2, 0] }, for: 30 },
    { pointer: { at: [2, 0] }, for: 240 },
    { pointer: { at: [2, 0], release: "primary" }, for: 2 },
  ],
};

export function dragCrate(rapier: RapierModule) {
  const run = runPlaytest<DragSnapshot>({
    rapier,
    game: dragGame,
    scene: floor,
    script: dragRight,
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run.final!;
}
