import type { Collider } from "@dimforge/rapier2d";
import { Container, Graphics } from "pixi.js";

import type { ColliderTag, Registry } from "../game/types";
import { traceShape } from "../render/draw-shape";
import type { GeometryWorld } from "../runtime/geometry-world";
import { shapeIsClosed } from "../scene/shape-outline";
import type { Pt, ShapeObj } from "../scene/types";
import { styleOf } from "../systems/bodies";
import type { RapierModule } from "../types";
import type { DebugLayerFactory, DebugSceneSource } from "./index";

/** A tagged collider's tint: the stroke, else the fill, of the look its entity is drawn in. */
export function colliderTint(tag: ColliderTag | undefined, registry: Registry): number | undefined {
  if (!tag) return undefined;
  const type = registry.types.get(tag.type);
  const style = type && styleOf({ registry }, type, tag.material);
  return style?.stroke ?? style?.fill;
}

/**
 * The collider's shape in world space, pose applied. Null for shapes the
 * scene format has no equivalent for.
 */
export function colliderShape(
  collider: Collider,
  ShapeType: RapierModule["ShapeType"],
): ShapeObj | null {
  const { x: cx, y: cy } = collider.translation();
  const rot = collider.rotation();
  const rotDeg = (rot * 180) / Math.PI;
  switch (collider.shapeType()) {
    case ShapeType.Cuboid: {
      const { x: hw, y: hh } = collider.halfExtents();
      return { type: "box", cx, cy, hw, hh, rotDeg };
    }
    case ShapeType.Ball:
      return { type: "circle", cx, cy, r: collider.radius() };
    case ShapeType.Capsule:
      return {
        type: "capsule",
        cx,
        cy,
        r: collider.radius(),
        halfLen: collider.halfHeight(),
        rotDeg,
      };
    case ShapeType.ConvexPolygon:
      return { type: "poly", pts: worldPoints(collider.vertices(), cx, cy, rot) };
    case ShapeType.Polyline:
      return { type: "chain", pts: worldPoints(collider.vertices(), cx, cy, rot) };
    default:
      return null;
  }
}

function worldPoints(flat: Float32Array, tx: number, ty: number, rot: number): Pt[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i]!;
    const y = flat[i + 1]!;
    pts.push([tx + x * cos - y * sin, ty + x * sin + y * cos]);
  }
  return pts;
}

/** The outline of a geometry-world collider with no tint; Rapier's own debug lines are drawn in a like grey. */
const GEOMETRY_LINE = 0xb0b0b0;

/** The loaded world; `geometry` is drawn when the scene runs without physics. */
export type WireframeSource = DebugSceneSource;

/** Each geometry-world collider's world shape, in handle order, with its tag's tint when it has one. */
export function geometryWireframes(
  geometry: GeometryWorld,
  source: Pick<DebugSceneSource, "tags" | "registry">,
): { handle: number; shape: ShapeObj; tint: number | undefined }[] {
  const out: { handle: number; shape: ShapeObj; tint: number | undefined }[] = [];
  for (const handle of geometry.handles()) {
    const shape = geometry.shape(handle);
    if (!shape) continue;
    out.push({ handle, shape, tint: colliderTint(source.tags.get(handle), source.registry) });
  }
  return out;
}

export type PhysicsWireframes = {
  update: (source: WireframeSource | null) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  container: Container;
};

export function createPhysicsWireframes(): PhysicsWireframes {
  const container = new Container();
  container.label = "debug-physics";

  const graphics = new Graphics();
  const tintGraphics = new Graphics();
  container.addChild(graphics);
  container.addChild(tintGraphics);

  function drawTinted(shape: ShapeObj, color: number): void {
    traceShape(tintGraphics, shape);
    if (shapeIsClosed(shape)) tintGraphics.fill({ color, alpha: 0.15 });
    tintGraphics.stroke({ width: 2, color, alpha: 0.8 });
  }

  function drawGeometry(geometry: GeometryWorld, source: WireframeSource): void {
    for (const { shape, tint } of geometryWireframes(geometry, source)) {
      traceShape(graphics, shape);
      graphics.stroke({ width: 1.5, color: GEOMETRY_LINE, alpha: 0.8 });
      if (tint !== undefined) drawTinted(shape, tint);
    }
  }

  function update(source: WireframeSource | null): void {
    graphics.clear();
    tintGraphics.clear();
    if (!source) return;
    const { physics, geometry } = source;
    if (!physics) {
      if (geometry) drawGeometry(geometry, source);
      return;
    }

    const { vertices, colors } = physics.debugRender();

    // Rapier returns line segments: every 4 floats in vertices = one segment
    // [x1, y1, x2, y2, ...] and colors has [r, g, b, a] per vertex
    for (let i = 0; i < vertices.length; i += 4) {
      const x1 = vertices[i];
      const y1 = vertices[i + 1];
      const x2 = vertices[i + 2];
      const y2 = vertices[i + 3];
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) break;

      // Each segment has 2 vertices, 4 color components each → 8 color values per segment
      const ci = (i / 4) * 8;
      const r = colors[ci];
      const g = colors[ci + 1];
      const b = colors[ci + 2];
      const a = colors[ci + 3];
      if (r === undefined || g === undefined || b === undefined || a === undefined) break;

      // Convert [0..1] floats to hex color
      const color =
        ((Math.round(r * 255) & 0xff) << 16) |
        ((Math.round(g * 255) & 0xff) << 8) |
        (Math.round(b * 255) & 0xff);

      graphics.setStrokeStyle({ width: 1.5, color, alpha: a * 0.8 });
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
      graphics.stroke();
    }

    const { tags, registry } = source;
    const { ShapeType } = physics.rapier;
    physics.world.forEachCollider((collider) => {
      const color = colliderTint(tags.get(collider.handle), registry);
      if (color === undefined) return;
      const shape = colliderShape(collider, ShapeType);
      if (shape) drawTinted(shape, color);
    });
  }

  function setVisible(visible: boolean): void {
    container.visible = visible;
  }

  function destroy(): void {
    graphics.destroy();
    tintGraphics.destroy();
    container.destroy();
  }

  return { update, setVisible, destroy, container };
}

/**
 * Rapier's collider outlines, or the geometry world's in a scene without
 * physics, with each tagged collider tinted by its type's style.
 */
export const physicsLayer: DebugLayerFactory = {
  id: "physics",
  create(host) {
    const wireframes = createPhysicsWireframes();
    host.worldContainer.addChild(wireframes.container);
    return {
      update: (frame) => wireframes.update(frame.scene),
      setVisible: wireframes.setVisible,
      destroy: wireframes.destroy,
    };
  },
};
