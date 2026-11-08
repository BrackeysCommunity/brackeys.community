import {
  Container,
  Graphics,
  type Matrix,
  NineSliceSprite,
  Sprite,
  type Texture,
  TilingSprite,
} from "pixi.js";

import {
  layerOrder,
  type SceneView,
  type SpriteVisual,
  type ViewLayer,
  type ViewLayerHandle,
} from "../context";
import type { Sha256 } from "../project/types";
import type { SceneLayerDef } from "../scene/layers";
import { drawShape } from "./draw-shape";
import { createSpriteTextures } from "./sprite-textures";

/** Textures by content hash, for the view's sprites. */
export type TextureSource = {
  get(hash: Sha256): Texture | null;
  /** Fires with each hash as it loads; returns unsubscribe. */
  onLoad(cb: (hash: Sha256) => void): () => void;
};

export type PixiViewOptions = {
  /**
   * Scene layers, matched to draws by their `draw` order (the first layer
   * with an order wins): a `sort: "y"` layer orders its visuals by (z, y,
   * first draw) each frame, a `scroll` layer is offset by the camera times
   * (1 − scroll), and an editor-only layer hides the visuals placed on it
   * by entity (those given a `depth`) unless `editing()`. Draws at an order
   * no layer has work as plain draw layers.
   */
  layers?: readonly SceneLayerDef[];
  /** Textures by content hash; a miss draws the fallback and retries when the loader says it arrived. */
  textures?: TextureSource;
  /** True in edit mode: editor-only layers show. */
  editing?: () => boolean;
  /** Round visual positions to whole canvas pixels each frame. */
  pixelSnap?: boolean;
};

export type PixiView = SceneView & {
  readonly container: Container;
  /** Destroys every visual and layer, and `container` with them. */
  destroy(): void;
};

type Pose = { x: number; y: number; rot: number };
type SpriteDisplay = Sprite | TilingSprite | NineSliceSprite;

/**
 * One id's display object and poses. `tick` is the view's tick sequence the
 * poses belong to; `snapped` keeps `prev` at `cur` for the rest of that tick.
 */
type Visual = {
  display: Container;
  layer: ViewLayer;
  prev: Pose;
  cur: Pose;
  tick: number;
  fresh: boolean;
  snapped: boolean;
  /** Set while `id` shows a sprite, or its fallback box while the texture loads. */
  sprite: { visual: SpriteVisual; texture: Texture | null } | null;
  /** The order inside its layer; null until `depth` places it as an entity's visual. */
  z: number | null;
  /** When it was first drawn: the tiebreak inside a layer. */
  seq: number;
  /** The y it was last placed at in a frame, before pixel snapping. */
  y: number;
};

const TAU = Math.PI * 2;

/** From `a` toward `b` by `t`, turning the shorter way round. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return a + d * t;
}

/** `current` when it is already the display `visual` needs, else a new one. */
function spriteDisplay(current: Container | undefined, visual: SpriteVisual, texture: Texture) {
  if (visual.nineSlice) {
    return current instanceof NineSliceSprite ? current : new NineSliceSprite({ texture });
  }
  if (visual.tile) return current instanceof TilingSprite ? current : new TilingSprite({ texture });
  return current instanceof Sprite ? current : new Sprite({ texture });
}

function applySprite(display: SpriteDisplay, visual: SpriteVisual, texture: Texture): void {
  const [w, h] = visual.size;
  const fx = visual.flipX ? -1 : 1;
  const fy = visual.flipY ? -1 : 1;
  display.texture = texture;
  if (display instanceof NineSliceSprite) {
    const [left, top, right, bottom] = visual.nineSlice!;
    display.leftWidth = left;
    display.topHeight = top;
    display.rightWidth = right;
    display.bottomHeight = bottom;
  }
  display.anchor.set(visual.anchor[0], visual.anchor[1]);
  if (display instanceof Sprite) {
    display.scale.set((w / texture.width) * fx, (h / texture.height) * fy);
  } else {
    display.setSize(w, h);
    display.scale.set(fx, fy);
  }
  display.tint = visual.tint ?? 0xffffff;
  display.alpha = visual.alpha ?? 1;
  display.blendMode = visual.blend ?? "normal";
}

/**
 * A scene view drawing into `container`: one child per layer, one display
 * object per id inside it (`Graphics` for drawings, a sprite kind for
 * sprites). Poses interpolate between the last two committed ticks in
 * `frame`.
 */
export function createPixiView(container: Container, opts: PixiViewOptions = {}): PixiView {
  const layers = new Map<number, Container>();
  const visuals = new Map<string, Visual>();
  const sceneLayers = new Map<number, SceneLayerDef>();
  for (const def of opts.layers ?? [])
    if (!sceneLayers.has(def.draw)) sceneLayers.set(def.draw, def);
  const ySorted = (order: number) => sceneLayers.get(order)?.sort === "y";
  const editing = () => opts.editing?.() ?? false;
  /** Visuals by display object, and first-seen order for a game's own children of a layer. */
  const byDisplay = new WeakMap<Container, Visual>();
  const firstSeen = new WeakMap<Container, number>();
  let seq = 0;
  const textures = opts.textures;
  const spriteTextures = textures ? createSpriteTextures(textures) : null;
  /** Ids showing a fallback until their texture loads. */
  const pending = new Set<string>();
  let unsubscribe: (() => void) | null = null;
  let open = 0;
  let committed = -1;
  container.sortableChildren = true;

  function layerContainer(layer: ViewLayer): Container {
    const order = layerOrder(layer);
    let c = layers.get(order);
    if (!c) {
      c = new Container();
      c.label = `layer:${order}`;
      c.zIndex = order;
      c.sortableChildren = !ySorted(order);
      container.addChild(c);
      layers.set(order, c);
    }
    return c;
  }

  function place(display: Container, p: Pose): void {
    display.position.set(p.x, p.y);
    display.rotation = p.rot;
  }

  /** `id`'s visual holding `display`, replacing whatever it showed before at the same place in its layer. */
  function show(id: string, display: Container, layer: ViewLayer): Visual {
    const target = layerContainer(layer);
    let v = visuals.get(id);
    if (!v) {
      const origin = { x: 0, y: 0, rot: 0 };
      v = {
        display,
        layer,
        prev: origin,
        cur: origin,
        tick: -1,
        fresh: true,
        snapped: false,
        sprite: null,
        z: null,
        seq: seq++,
        y: 0,
      };
      visuals.set(id, v);
    } else if (v.display !== display) {
      const old = v.display;
      const parent = old.parent;
      if (parent === target) target.addChildAt(display, parent.getChildIndex(old));
      display.zIndex = old.zIndex;
      old.destroy();
      v.display = display;
    }
    display.label = id;
    v.layer = layer;
    byDisplay.set(display, v);
    if (!ySorted(layerOrder(layer))) display.zIndex = v.z ?? 0;
    place(display, v.cur);
    if (display.parent !== target) target.addChild(display);
    applyVisible(v);
    return v;
  }

  /** Hidden while it sits on an editor-only layer as an entity's visual and the view isn't editing. */
  function applyVisible(v: Visual): void {
    const editorOnly = sceneLayers.get(layerOrder(v.layer))?.editorOnly === true;
    v.display.visible = !(editorOnly && v.z !== null) || editing();
  }

  function sortKey(child: Container): [z: number, y: number, seq: number] {
    const v = byDisplay.get(child);
    if (v && visuals.get(child.label) === v) return [v.z ?? 0, v.y, v.seq];
    let first = firstSeen.get(child);
    if (first === undefined) {
      first = seq++;
      firstSeen.set(child, first);
    }
    return [child.zIndex, child.position.y, first];
  }

  /** Reorders a y-sorted layer's children by (z, y, first draw). */
  function ySort(layer: Container): void {
    const keyed = layer.children.map((child) => ({ child, key: sortKey(child) }));
    keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
    keyed.forEach(({ child }, i) => {
      if (layer.children[i] !== child) layer.setChildIndex(child, i);
    });
  }

  function graphicsFor(id: string): Graphics {
    const display = visuals.get(id)?.display;
    if (display instanceof Graphics) {
      display.clear();
      return display;
    }
    return new Graphics();
  }

  function releaseSprite(v: Visual): void {
    if (v.sprite?.texture) spriteTextures?.release(v.sprite.texture);
    v.sprite = null;
  }

  function settle(id: string): void {
    pending.delete(id);
    if (pending.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function waitForTexture(id: string): void {
    pending.add(id);
    if (unsubscribe || !textures) return;
    unsubscribe = textures.onLoad((hash) => {
      for (const waiting of [...pending]) {
        const v = visuals.get(waiting);
        if (v?.sprite?.visual.texture === hash) drawSpriteVisual(waiting, v.sprite.visual, v.layer);
      }
    });
  }

  function drawSpriteVisual(id: string, visual: SpriteVisual, layer: ViewLayer): void {
    const texture =
      visual.texture && spriteTextures
        ? spriteTextures.acquire(visual.texture, visual.frame, visual.sampling)
        : null;
    const previous = visuals.get(id);
    let v: Visual;
    if (texture) {
      const display = spriteDisplay(previous?.display, visual, texture);
      applySprite(display, visual, texture);
      v = show(id, display, layer);
      settle(id);
    } else {
      const g = graphicsFor(id);
      drawShape(g, visual.fallback.shape, visual.fallback.style);
      v = show(id, g, layer);
      if (visual.texture && textures) waitForTexture(id);
      else settle(id);
    }
    if (v.sprite?.texture) spriteTextures?.release(v.sprite.texture);
    v.sprite = { visual, texture };
  }

  /** Where `v` sits this frame: between its last two poses when the last committed tick moved it. */
  function placed(v: Visual, alpha: number): Pose {
    if (v.tick !== committed || v.snapped) return v.cur;
    const { prev, cur } = v;
    return {
      x: prev.x + (cur.x - prev.x) * alpha,
      y: prev.y + (cur.y - prev.y) * alpha,
      rot: lerpAngle(prev.rot, cur.rot, alpha),
    };
  }

  function placeVisuals(alpha: number): void {
    const toCanvas = new Map<Container, Matrix | null>();
    for (const v of visuals.values()) {
      const p = placed(v, alpha);
      v.y = p.y;
      const parent = v.display.parent;
      if (opts.pixelSnap && parent) {
        let m = toCanvas.get(parent);
        if (m === undefined) {
          m = parent.getGlobalTransform();
          if (m.a === 0 || m.d === 0) m = null;
          toCanvas.set(parent, m);
        }
        if (m) {
          place(v.display, {
            x: (Math.round(m.a * p.x + m.tx) - m.tx) / m.a,
            y: (Math.round(m.d * p.y + m.ty) - m.ty) / m.d,
            rot: p.rot,
          });
          continue;
        }
      }
      place(v.display, p);
    }
  }

  return {
    container,
    draw(id, shape, style, layer) {
      const g = graphicsFor(id);
      drawShape(g, shape, style);
      const v = show(id, g, layer);
      releaseSprite(v);
      settle(id);
    },
    sprite: drawSpriteVisual,
    pose(id, x, y, rot = 0, snap = false) {
      const v = visuals.get(id);
      if (!v) return;
      if (v.tick !== open) {
        v.prev = v.cur;
        v.tick = open;
        v.snapped = false;
      }
      v.cur = { x, y, rot };
      if (snap || v.fresh) v.snapped = true;
      v.fresh = false;
      if (v.snapped) v.prev = v.cur;
      place(v.display, v.cur);
    },
    commit() {
      committed = open;
      open++;
    },
    frame({ alpha, camera }) {
      for (const [order, layer] of layers) {
        const scroll = sceneLayers.get(order)?.scroll;
        if (scroll) layer.position.set(camera.x * (1 - scroll[0]), camera.y * (1 - scroll[1]));
      }
      placeVisuals(alpha);
      for (const [order, layer] of layers) if (ySorted(order)) ySort(layer);
      for (const v of visuals.values()) applyVisible(v);
    },
    depth(id, z) {
      const v = visuals.get(id);
      if (!v) return;
      v.z = z;
      if (!ySorted(layerOrder(v.layer))) v.display.zIndex = z;
      applyVisible(v);
    },
    remove(id) {
      const v = visuals.get(id);
      if (!v) return;
      releaseSprite(v);
      settle(id);
      v.display.destroy();
      visuals.delete(id);
    },
    layer: (layer) => layerContainer(layer) as unknown as ViewLayerHandle,
    destroy() {
      for (const v of visuals.values()) releaseSprite(v);
      spriteTextures?.destroy();
      unsubscribe?.();
      unsubscribe = null;
      pending.clear();
      visuals.clear();
      layers.clear();
      container.destroy({ children: true });
    },
  };
}

/** The Pixi container behind a Pixi view's layer handle, for a game drawing what the view can't. */
export function pixiContainer(handle: ViewLayerHandle): Container {
  if (!(handle instanceof Container)) throw new Error("not a Pixi view layer");
  return handle;
}
