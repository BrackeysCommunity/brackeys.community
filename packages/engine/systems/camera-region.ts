import { outlineOnly } from "../game/primitives";
import { styleOf } from "../game/style";
import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import { regionBox } from "../scene/shape-geometry";
import type { RuntimeEntity, ShapeObj } from "../scene/types";

export type CameraRegionEntity = RuntimeEntity<{
  shape: ShapeObj;
  zoom?: number;
  clamp?: boolean;
  ease?: number;
}>;

/**
 * Camera regions: the shell's camera rig reads them from the expanded
 * scene, so this system keeps no state of its own. It draws the box each
 * region frames on the registry's editor-only layer as an entity visual,
 * which the view shows while editing and hides in Play; a registry without an
 * editor-only layer, or a view that can't order visuals, draws nothing.
 */
export function createCameraRegionSystem(
  ctx: EngineContext,
  type: RegisteredType,
): SceneSystem<CameraRegionEntity> {
  const live = new Set<string>();
  const editorLayer = ctx.registry.layers.find((l) => l.editorOnly)?.draw;
  const style = styleOf(ctx, type, undefined);
  const outline = style ? outlineOnly(style) : undefined;

  const draw = (e: CameraRegionEntity) => {
    const view = ctx.view;
    if (!view?.depth || editorLayer === undefined || !outline) return;
    view.draw(e.id, regionBox(e.shape), outline, editorLayer);
    view.depth(e.id, e.z ?? 0);
  };
  const remove = (id: string) => ctx.view?.remove(id);

  return {
    spawn(e) {
      live.add(e.id);
      draw(e);
    },
    despawn(id) {
      if (live.delete(id)) remove(id);
    },
    clear() {
      for (const id of live) remove(id);
      live.clear();
    },
    update(e) {
      live.add(e.id);
      draw(e);
    },
    size: () => live.size,
    /** Nothing here simulates, so a disabled region keeps its outline as it is. */
    disable() {},
    enable() {},
  };
}
