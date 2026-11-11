import type { Vec2 } from "@jams/engine";
import type { EngineContext, SceneSystem } from "@jams/engine/game";

import { PLATFORMER_LAYERS } from "../layers";
import type { AnchorEntity } from "../types";

// ─── Config ──────────────────────────────────────────────

/** The farthest the grapple reaches to attach, metres. */
export const GRAPPLE_RANGE = 4;
export const GRAPPLE_ROPE_COLOR = 0x88ddff;
export const GRAPPLE_ANCHOR_COLOR = 0x88ddff;
/** An anchor's drawn radius, metres. */
export const GRAPPLE_ANCHOR_RADIUS = 0.08;

/** The view id of the rope; `#` keeps it apart from scene and bulk ids. */
const TETHER_ID = "~grapple#tether";
const ANCHOR_STYLE = { fill: GRAPPLE_ANCHOR_COLOR, alpha: 0.6 };
const CORE_STYLE = { fill: 0xffffff, alpha: 0.8 };
const TETHER_STYLE = { stroke: GRAPPLE_ROPE_COLOR, alpha: 0.7, strokeWidth: 2 };

// ─── Types ───────────────────────────────────────────────

/** `scene` anchors come from the scene file; `runtime` ones are placed during play. */
export type AnchorSource = "scene" | "runtime";

export type GrappleAnchor = {
  id: string;
  position: Vec2;
  source: AnchorSource;
};

export type GrappleAnchorSystem = SceneSystem<AnchorEntity> & {
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
  const anchors = new Map<string, GrappleAnchor>();

  function add(id: string, position: Vec2, source: AnchorSource): void {
    remove(id);
    anchors.set(id, { id, position: { ...position }, source });
    if (!view) return;
    const { x: cx, y: cy } = position;
    const r = GRAPPLE_ANCHOR_RADIUS;
    view.draw(id, { type: "circle", cx, cy, r }, ANCHOR_STYLE, PLATFORMER_LAYERS.anchor);
    view.draw(
      `${id}#core`,
      { type: "circle", cx, cy, r: r * 0.5 },
      CORE_STYLE,
      PLATFORMER_LAYERS.anchor,
    );
  }

  function remove(id: string): void {
    if (!anchors.delete(id)) return;
    view?.remove(id);
    view?.remove(`${id}#core`);
  }

  function getAnchors(): GrappleAnchor[] {
    return Array.from(anchors.values());
  }

  function findClosest(from: Vec2, maxRange = GRAPPLE_RANGE): GrappleAnchor | null {
    let closest: GrappleAnchor | null = null;
    let closestDist = maxRange * maxRange; // compare squared distances

    for (const anchor of anchors.values()) {
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
    const pts: [number, number][] = [
      [from.x, from.y],
      [to.x, to.y],
    ];
    view?.draw(TETHER_ID, { type: "chain", pts }, TETHER_STYLE, PLATFORMER_LAYERS.tether);
  }

  function clearTether(): void {
    view?.remove(TETHER_ID);
  }

  function clear(): void {
    for (const id of [...anchors.keys()]) remove(id);
    clearTether();
  }

  return {
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
      for (const anchor of [...anchors.values()]) {
        if (anchor.source === "runtime") remove(anchor.id);
      }
    },
    destroy: clear,
  };
}
