import type { Container } from "pixi.js";

import type { ColliderTags } from "./collider-tags";
import type { ForceFields } from "./force-fields";
import type { PhysicsWorld } from "./physics";
import type { Bounds } from "./scene/types";
import type { RapierModule } from "./types";

/** Where a runtime's systems draw. `null` in headless runs. */
export type SceneView = { world: Container };

/** Draw order inside a scene view, bottom to top, whatever order systems spawn in. */
export const DRAW_LAYERS = {
  mover: 10,
  anchor: 20,
  tether: 21,
  player: 30,
  cloud: 40,
  construct: 50,
  preview: 60,
} as const;

export type DrawLayer = keyof typeof DRAW_LAYERS;

export function addToLayer(world: Container, child: Container, layer: DrawLayer): void {
  child.zIndex = DRAW_LAYERS[layer];
  world.sortableChildren = true;
  world.addChild(child);
}

/** Everything a scene system needs, scoped to one runtime. */
export type EngineContext = {
  rapier: RapierModule;
  physics: PhysicsWorld;
  view: SceneView | null;
  tags: ColliderTags;
  fields: ForceFields;
  dev: boolean;
  bounds: Bounds;
};
