import { Container, Graphics } from "pixi.js";
import type { PhysicsWorld } from "../physics";
import { getSurfaceType, type SurfaceType } from "../surfaces";

// Colors for each surface type in debug wireframes
const SURFACE_COLORS: Record<SurfaceType, number> = {
  normal: 0xff8800, // orange (default Rapier color)
  ice: 0x88ddff, // light blue
  trampoline: 0xff00ff, // magenta
  lava: 0xff2222, // red
  chocolate: 0x8b4513, // brown
  cloud: 0xffffff, // white
};

export type PhysicsWireframes = {
  update: () => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  container: Container;
};

export function createPhysicsWireframes(physicsWorld: PhysicsWorld): PhysicsWireframes {
  const container = new Container();
  container.label = "debug-physics";

  const graphics = new Graphics();
  const surfaceGraphics = new Graphics();
  container.addChild(graphics);
  container.addChild(surfaceGraphics);

  function update(): void {
    graphics.clear();
    surfaceGraphics.clear();

    const { vertices, colors } = physicsWorld.debugRender();

    // Rapier returns line segments: every 4 floats in vertices = one segment
    // [x1, y1, x2, y2, ...] and colors has [r, g, b, a] per vertex
    for (let i = 0; i < vertices.length; i += 4) {
      const x1 = vertices[i];
      const y1 = vertices[i + 1];
      const x2 = vertices[i + 2];
      const y2 = vertices[i + 3];

      // Each segment has 2 vertices, 4 color components each → 8 color values per segment
      const ci = (i / 4) * 8;
      const r = colors[ci];
      const g = colors[ci + 1];
      const b = colors[ci + 2];
      const a = colors[ci + 3];

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

    // Draw surface-colored overlays on registered colliders
    const world = physicsWorld.world;
    world.forEachCollider((collider) => {
      const surfaceType = getSurfaceType(collider.handle);
      if (surfaceType === "normal") return; // skip normal — already drawn by Rapier

      const color = SURFACE_COLORS[surfaceType];
      const pos = collider.translation();
      const halfExtents = collider.halfExtents();
      if (!halfExtents) return; // ball/capsule — skip for now

      const x = pos.x - halfExtents.x;
      const y = pos.y - halfExtents.y;
      const w = halfExtents.x * 2;
      const h = halfExtents.y * 2;

      // Filled semi-transparent overlay
      surfaceGraphics.rect(x, y, w, h);
      surfaceGraphics.fill({ color, alpha: 0.15 });

      // Colored border
      surfaceGraphics.setStrokeStyle({ width: 2, color, alpha: 0.8 });
      surfaceGraphics.rect(x, y, w, h);
      surfaceGraphics.stroke();
    });
  }

  function setVisible(visible: boolean): void {
    container.visible = visible;
    if (visible) {
      update();
    }
  }

  function destroy(): void {
    graphics.destroy();
    surfaceGraphics.destroy();
    container.destroy();
  }

  return { update, setVisible, destroy, container };
}
