import type { EngineContext, SceneSystem, Style } from "@jams/engine/game";
import type { RuntimeEntity, ShapeObj } from "@jams/engine/scene";

export type Visuals = {
  /** Redraws each entity whose look is no longer the one it was drawn with. */
  refresh: () => void;
};

/**
 * Draws each entity a system spawns through the view, in `look(e)`, under
 * the entity's id; the drawing goes with the entity. The system's own
 * physics is untouched; without a view it comes back as it was. `update` is
 * dropped so an edit respawns, and so redraws.
 */
export function withVisuals<E extends RuntimeEntity<{ shape: ShapeObj }>, S extends SceneSystem<E>>(
  ctx: Pick<EngineContext, "view">,
  inner: S,
  layer: number,
  look: (e: E) => Style,
): { system: S; visuals: Visuals } {
  const { view } = ctx;
  if (!view) return { system: inner, visuals: { refresh() {} } };

  const drawn = new Map<string, { e: E; look: Style }>();

  const draw = (e: E, style: Style): void => {
    view.draw(e.id, e.shape, style, layer);
    drawn.set(e.id, { e, look: style });
  };
  const forget = (id: string): void => {
    view.remove(id);
    drawn.delete(id);
  };

  const system: S = {
    ...inner,
    spawn(e: E) {
      inner.spawn(e);
      draw(e, look(e));
    },
    despawn(id: string) {
      inner.despawn(id);
      forget(id);
    },
    clear() {
      inner.clear();
      for (const id of [...drawn.keys()]) forget(id);
    },
  };
  delete system.update;
  const visuals: Visuals = {
    refresh() {
      for (const entry of drawn.values()) {
        const next = look(entry.e);
        if (next !== entry.look) draw(entry.e, next);
      }
    },
  };
  return { system, visuals };
}
