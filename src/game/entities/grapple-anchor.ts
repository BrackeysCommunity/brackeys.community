import { Container, Graphics } from "pixi.js";

import { addToLayer, type EngineContext } from "../context";
import type { EntityOf, SceneSystem } from "../systems/scene-system";
import type { Vec2 } from "../types";

// ─── Config ──────────────────────────────────────────────

export const GRAPPLE_RANGE = 400; // max distance to attach
export const GRAPPLE_ROPE_COLOR = 0x88ddff;
export const GRAPPLE_ANCHOR_COLOR = 0x88ddff;
export const GRAPPLE_ANCHOR_RADIUS = 8;

// ─── Types ───────────────────────────────────────────────

/** `scene` anchors come from the scene file; `runtime` ones are placed during play. */
export type AnchorSource = "scene" | "runtime";

export type GrappleAnchor = {
  id: string;
  position: Vec2;
  source: AnchorSource;
};

export type GrappleAnchorSystem = SceneSystem<EntityOf<"anchor">> & {
  add: (id: string, position: Vec2, source: AnchorSource) => void;
  getAnchors: () => GrappleAnchor[];
  /** Find the closest anchor within range of a point, or null */
  findClosest: (from: Vec2, maxRange?: number) => GrappleAnchor | null;
  /** Draw/update the tether line between player and anchor */
  drawTether: (from: Vec2, to: Vec2) => void;
  clearTether: () => void;
  /** Remove anchors placed during play, keeping the scene's (round reset) */
  clearRuntime: () => void;
  destroy: () => void;
};

// ─── System ──────────────────────────────────────────────

export function createGrappleAnchorSystem(ctx: Pick<EngineContext, "view">): GrappleAnchorSystem {
  const { view } = ctx;
  let container: Container | null = null;
  let tetherGraphics: Graphics | null = null;
  if (view) {
    container = new Container();
    container.label = "grapple-anchors";
    addToLayer(view.world, container, "anchor");
    tetherGraphics = new Graphics();
    tetherGraphics.label = "grapple-tether";
    addToLayer(view.world, tetherGraphics, "tether");
  }

  const anchors = new Map<string, { anchor: GrappleAnchor; graphics: Graphics | null }>();

  function add(id: string, position: Vec2, source: AnchorSource): void {
    remove(id);
    let gfx: Graphics | null = null;
    if (container) {
      gfx = new Graphics();
      gfx.circle(0, 0, GRAPPLE_ANCHOR_RADIUS);
      gfx.fill({ color: GRAPPLE_ANCHOR_COLOR, alpha: 0.6 });
      gfx.circle(0, 0, GRAPPLE_ANCHOR_RADIUS * 0.5);
      gfx.fill({ color: 0xffffff, alpha: 0.8 });
      gfx.position.set(position.x, position.y);
      container.addChild(gfx);
    }
    anchors.set(id, { anchor: { id, position: { ...position }, source }, graphics: gfx });
  }

  function remove(id: string): void {
    const entry = anchors.get(id);
    if (!entry) return;
    entry.graphics?.destroy();
    anchors.delete(id);
  }

  function getAnchors(): GrappleAnchor[] {
    return Array.from(anchors.values()).map((e) => e.anchor);
  }

  function findClosest(from: Vec2, maxRange = GRAPPLE_RANGE): GrappleAnchor | null {
    let closest: GrappleAnchor | null = null;
    let closestDist = maxRange * maxRange; // compare squared distances

    for (const { anchor } of anchors.values()) {
      const dx = anchor.position.x - from.x;
      const dy = anchor.position.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDist) {
        closestDist = distSq;
        closest = anchor;
      }
    }

    return closest;
  }

  function drawTether(from: Vec2, to: Vec2): void {
    if (!tetherGraphics) return;
    tetherGraphics.clear();
    tetherGraphics.setStrokeStyle({ width: 2, color: GRAPPLE_ROPE_COLOR, alpha: 0.7 });
    tetherGraphics.moveTo(from.x, from.y);
    tetherGraphics.lineTo(to.x, to.y);
    tetherGraphics.stroke();
  }

  function clearTether(): void {
    tetherGraphics?.clear();
  }

  function clear(): void {
    for (const id of [...anchors.keys()]) remove(id);
    clearTether();
  }

  return {
    behaviors: ["anchor"],
    spawn(e) {
      add(e.id, { x: e.at[0], y: e.at[1] }, "scene");
    },
    despawn: remove,
    clear,
    size: () => anchors.size,
    add,
    getAnchors,
    findClosest,
    drawTether,
    clearTether,
    clearRuntime() {
      for (const { anchor } of [...anchors.values()]) {
        if (anchor.source === "runtime") remove(anchor.id);
      }
    },
    destroy() {
      clear();
      tetherGraphics?.destroy();
      container?.destroy();
    },
  };
}
