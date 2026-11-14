// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createPoseIndex, relativePose } from "../runtime/poses";
import { createSceneTree, type SceneTreeDeps } from "../runtime/tree";
import type { RuntimeEntity } from "../scene/types";
import { engineErrorCode, expectPoseClose } from "./fixtures/tree-rig";

/** A tree over a pose index, with every dependency a set or a log the test reads. */
function world() {
  let tick = 0;
  let stepping = false;
  const poses = createPoseIndex(() => tick);
  const live = new Set<string>();
  const carriers = new Set<string>();
  const scopes = new Map<string, string>();
  const rides: string[] = [];
  const reparented: string[] = [];
  const deps: SceneTreeDeps = {
    poses,
    setPose: (id, x, y, rot) => poses.set(id, x, y, rot),
    exists: (id) => live.has(id),
    enabled: (id) => live.has(id),
    selfMoving: () => false,
    follows: (id) => (live.has(id) ? "pose" : "still"),
    carries: (id) => carriers.has(id),
    ride: (id, host) => void rides.push(`${id}>${host}`),
    scopeOf: (id) => scopes.get(id) ?? null,
    reparented: (id) => void reparented.push(id),
    stepping: () => stepping,
    tick: () => tick,
  };
  const tree = createSceneTree(deps);
  /** Poses each entity and links the batch, as a load does. */
  const add = (...list: [id: string, x: number, y: number, rot?: number, parent?: string][]) => {
    const entities: RuntimeEntity[] = list.map(([id, x, y, rot = 0, parent]) => {
      live.add(id);
      poses.set(id, x, y, rot, { snap: true });
      return { id, type: "marker", at: [x, y], ...(parent !== undefined ? { parent } : {}) };
    });
    tree.link(entities);
  };
  const destroy = (id: string) => {
    for (const at of [...tree.subtree(id)].reverse()) {
      live.delete(at);
      poses.remove(at);
      tree.forget(at);
    }
  };
  return {
    tree,
    poses,
    carriers,
    scopes,
    rides,
    reparented,
    add,
    destroy,
    setTick: (t: number) => void (tick = t),
    setStepping: (on: boolean) => void (stepping = on),
  };
}

describe("the scene tree's links", () => {
  it("links a batch's children under their parents, in the order given", () => {
    const { tree, add } = world();
    add(
      ["room", 0, 0],
      ["door", 1, 0, 0, "room"],
      ["lamp", 2, 0, 0, "room"],
      ["panel", 1, 1, 0, "door"],
    );
    expect(tree.parent("door")).toBe("room");
    expect(tree.parent("room")).toBeNull();
    expect(tree.children("room")).toEqual(["door", "lamp"]);
    expect(tree.children("lamp")).toEqual([]);
    expect(tree.subtree("room")).toEqual(["room", "door", "panel", "lamp"]);
    expect(tree.root("panel")).toBe("room");
    expect(tree.isUnder("panel", "room")).toBe(true);
    expect(tree.isUnder("panel", "panel")).toBe(true);
    expect(tree.isUnder("room", "panel")).toBe(false);
    expect(tree.isUnder("lamp", "door")).toBe(false);
  });

  it("leaves an entity whose parent isn't live a root", () => {
    const { tree, add } = world();
    add(["stray", 0, 0, 0, "nowhere"]);
    expect(tree.parent("stray")).toBeNull();
  });

  it("hands out child lists that a later link doesn't change", () => {
    const { tree, add } = world();
    add(["room", 0, 0], ["door", 1, 0, 0, "room"]);
    const before = tree.children("room");
    add(["lamp", 2, 0, 0, "room"]);
    expect(before).toEqual(["door"]);
    expect(tree.children("room")).toEqual(["door", "lamp"]);
  });

  it("asks each linked child to ride the nearest body above it", () => {
    const { add, carriers, rides } = world();
    carriers.add("cart");
    add(["cart", 0, 0], ["seat", 0, 0, 0, "cart"], ["cushion", 0, 0, 0, "seat"], ["post", 5, 0]);
    expect(rides).toEqual(["seat>cart", "cushion>cart"]);
  });
});

describe("local poses", () => {
  it("are the pose in the parent's frame, and the world pose for a root", () => {
    const { tree, add } = world();
    add(["room", 10, 0, Math.PI / 2], ["door", 10, 2, 0, "room"]);
    expectPoseClose(tree.local("door"), { x: 2, y: 0, rot: -Math.PI / 2 }, "door", 9);
    expect(tree.local("room")).toEqual({ x: 10, y: 0, rot: Math.PI / 2 });
  });

  it("setLocal places a child in its parent's frame, and a root in the world", () => {
    const { tree, add, poses } = world();
    add(["room", 10, 0, Math.PI / 2], ["door", 10, 2, 0, "room"], ["panel", 10, 3, 0, "door"]);
    tree.setLocal("door", 0, 3, 0);
    expectPoseClose(poses.get("door"), { x: 7, y: 0, rot: Math.PI / 2 }, "door", 9);
    expect(tree.local("door")).toEqual({ x: 0, y: 3, rot: 0 });
    // The grandchild keeps its place in the door's frame.
    expect(tree.local("panel")).toEqual({ x: 0, y: 1, rot: 0 });
    expectPoseClose(poses.get("panel"), { x: 6, y: 0, rot: Math.PI / 2 }, "panel", 9);
    tree.setLocal("room", 1, 1);
    expect(poses.get("room")).toMatchObject({ x: 1, y: 1 });
  });

  it("follow a write the tree didn't make", () => {
    const { tree, add, poses } = world();
    add(["room", 0, 0], ["door", 1, 0, 0, "room"]);
    poses.set("door", 4, 4, 1);
    expect(tree.local("door")).toEqual({ x: 4, y: 4, rot: 1 });
  });
});

describe("setParent", () => {
  it("keeps the world pose by default and recomputes the local one", () => {
    const { tree, add, poses, reparented } = world();
    add(["a", 0, 0], ["b", 5, 0, Math.PI], ["kid", 1, 0, 0, "a"]);
    tree.setParent("kid", "b");
    expect(tree.parent("kid")).toBe("b");
    expect(tree.children("a")).toEqual([]);
    expect(tree.children("b")).toEqual(["kid"]);
    expect(poses.get("kid")).toEqual({ x: 1, y: 0, rot: 0 });
    const kid = relativePose({ x: 1, y: 0, rot: 0 }, { x: 5, y: 0, rot: Math.PI });
    expectPoseClose(tree.local("kid"), kid, "kid", 9);
    expect(reparented).toEqual(["kid"]);
  });

  it("with keepWorld false keeps the local pose and moves the world one", () => {
    const { tree, add, poses } = world();
    add(["a", 0, 0], ["b", 5, 0], ["kid", 1, 0, 0, "a"], ["toy", 1, 1, 0, "kid"]);
    tree.setParent("kid", "b", { keepWorld: false });
    expect(tree.local("kid")).toEqual({ x: 1, y: 0, rot: 0 });
    expect(poses.get("kid")).toEqual({ x: 6, y: 0, rot: 0 });
    expect(poses.get("toy")).toEqual({ x: 6, y: 1, rot: 0 });
  });

  it("to null makes a root, and appends to the new parent's children", () => {
    const { tree, add } = world();
    add(["a", 0, 0], ["x", 1, 0, 0, "a"], ["y", 2, 0, 0, "a"], ["z", 3, 0]);
    tree.setParent("x", null);
    expect(tree.parent("x")).toBeNull();
    expect(tree.local("x")).toEqual({ x: 1, y: 0, rot: 0 });
    tree.setParent("z", "a");
    tree.setParent("x", "a");
    expect(tree.children("a")).toEqual(["y", "z", "x"]);
  });

  it("asks the moved subtree to ride the body now above it", () => {
    const { tree, add, carriers, rides } = world();
    carriers.add("cart");
    add(["cart", 0, 0], ["box", 3, 0], ["lid", 3, 1, 0, "box"]);
    rides.length = 0;
    tree.setParent("box", "cart");
    expect(rides).toEqual(["box>cart", "lid>cart"]);
    rides.length = 0;
    tree.setParent("box", null);
    expect(rides).toEqual(["box>null", "lid>null"]);
  });

  it("refuses a cycle, a parent that isn't live or is in another sublevel, and a gone entity", () => {
    const { tree, add, scopes } = world();
    add(["a", 0, 0], ["b", 0, 0, 0, "a"], ["c", 0, 0, 0, "b"], ["cellar:d", 0, 0]);
    scopes.set("cellar:d", "cellar");
    expect(engineErrorCode(() => tree.setParent("a", "c"))).toBe("parent-cycle");
    expect(engineErrorCode(() => tree.setParent("a", "a"))).toBe("parent-cycle");
    expect(engineErrorCode(() => tree.setParent("b", "cellar:d"))).toBe("parent-scope");
    expect(engineErrorCode(() => tree.setParent("cellar:d", "a"))).toBe("parent-scope");
    expect(engineErrorCode(() => tree.setParent("ghost", "a"))).toBe("entity-gone");
    expect(engineErrorCode(() => tree.setParent("b", "ghost"))).toBe("parent-scope");
    expect(tree.subtree("a")).toEqual(["a", "b", "c"]);
  });
});

describe("isUnder after a destroy", () => {
  it("answers for entities destroyed this tick, until the tick moves on", () => {
    const { tree, add, destroy, setTick, setStepping } = world();
    add(["room", 0, 0], ["door", 0, 0, 0, "room"], ["panel", 0, 0, 0, "door"]);
    setTick(5);
    setStepping(true);
    destroy("door");
    expect(tree.subtree("room")).toEqual(["room"]);
    expect(tree.parent("panel")).toBeNull();
    expect(tree.isUnder("panel", "room")).toBe(true);
    expect(tree.isUnder("door", "room")).toBe(true);
    setTick(6);
    expect(tree.isUnder("panel", "room")).toBe(false);
  });

  it("forgets at once outside a step", () => {
    const { tree, add, destroy } = world();
    add(["room", 0, 0], ["door", 0, 0, 0, "room"]);
    destroy("door");
    expect(tree.isUnder("door", "room")).toBe(false);
  });

  it("makes the children of an entity that leaves alone roots", () => {
    const { tree, add, poses } = world();
    add(["room", 0, 0], ["door", 1, 0, 0, "room"], ["panel", 2, 0, 0, "door"]);
    poses.remove("door");
    tree.forget("door");
    expect(tree.parent("panel")).toBeNull();
    expect(tree.children("room")).toEqual([]);
    expect(tree.local("panel")).toEqual({ x: 2, y: 0, rot: 0 });
  });
});
