import { createRegistry, defineGame, defineScript } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { expandScene, prefabLibrary, type Prefab, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

/** Sweeps its entity back and forth in its parent's frame: the angle it writes is local. */
const sweep = defineScript({
  name: "yard/sweep",
  description: "Turns the entity to and fro about its parent.",
  fields: { arc: z.number().positive().default(0.5).describe("Half the sweep, rad.") },
  create(self) {
    let t = 0;
    return {
      step() {
        t++;
        const { x, y } = self.entity.localPose;
        self.entity.setLocalPose(x, y, Math.sin(t / 30) * self.fields.arc);
      },
    };
  },
});

const yard = defineGame({
  id: "yard",
  types: [],
  behaviors: [sweep],
  actions: [],
  world: { physics: "none" },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});

/** A base, a barrel that sweeps, and a sensor ahead of them. */
const turret: Prefab = {
  kind: "prefab",
  v: 4,
  game: "yard",
  id: "turret",
  entities: [
    { id: "base", type: "solid", shape: ["box", 0, 0, 0.4, 0.4] },
    { id: "barrel", type: "marker", at: [0.5, 0], behaviors: { "yard/sweep": {} } },
    { id: "sight", type: "sensor", shape: ["box", 1.5, 0, 0.5, 0.1] },
  ],
};

/** A cart with one turret on it, placed by the scene. */
const lot: SceneDefinition = {
  v: 4,
  game: "yard",
  name: "lot",
  bounds: [0, 0, 12, 8],
  entities: [{ id: "cart", type: "node", at: [2, 4] }],
  instances: [{ id: "front", prefab: "turret", at: [3, 4] }],
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Moves a cart with turrets on it, then switches it off, saves and tears it down. */
export function cartRun() {
  const registry = createRegistry(yard);
  const prefabs = prefabLibrary([turret]);
  const rt = createHeadlessRuntime({
    game: yard,
    registry,
    scene: expandScene(lot, registry, { prefabs }),
    prefabs,
  });
  const { ctx } = rt;
  const cart = ctx.entity("cart")!;

  // The scene's instance is a live node over its children; put it on the cart.
  const front = ctx.entity("front")!;
  front.setParent(cart);
  // A spawned one goes straight under the cart, one metre behind it.
  const rear = ctx.instantiate("turret", [-1, 0], { parent: "cart", local: true });

  // Move and turn the cart: everything under it follows, sweeps included.
  for (let i = 0; i < 60; i++) {
    cart.setPose(2 + i * 0.05, 4, (i / 60) * (Math.PI / 2));
    rt.step(ctx.time.tickMs, []);
  }
  const barrel = front.find("barrel")!;
  const moved = {
    rear: rear.id,
    root: barrel.root.id,
    front: { x: round(front.pose.x), y: round(front.pose.y) },
    under: ctx.entities({ under: "cart" }).map((e) => e.id),
    // The barrel sits where the prefab put it on the base, whatever the cart did.
    barrel: { x: round(barrel.localPose.x), y: round(barrel.localPose.y) },
    sweeps: cart.getBehaviorsInChildren(sweep).length,
  };

  // Off with the cart: the turrets are off too, though their own switches are on.
  cart.setEnabled(false);
  const off = { enabled: barrel.enabled, enabledSelf: barrel.enabledSelf };
  cart.setEnabled(true);

  // A world save keeps only the links the load didn't make: here, front's.
  const saved = rt.save({ depth: "world", slot: "lot", now: 0 });
  const parents = saved.ok ? saved.file.world?.parents : undefined;

  // Destroying the cart destroys both turrets with it, children first.
  cart.destroy();
  const left = ctx.query.count();
  rt.destroy();
  return { ...moved, off, parents, left, barrelAlive: barrel.alive };
}
