// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { show } from "../tools/show";
import { tempProject } from "./fixtures";

type Row = Record<string, unknown> & {
  ref: string;
  depth?: number;
  aabb?: { minX: number; minY: number; maxX: number; maxY: number };
};

const kit = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "kit",
  entities: [
    { id: "hinge", type: "node", at: [1, 0] },
    { id: "pin", type: "marker", parent: "hinge", at: [0, 1] },
    { id: "loose", type: "marker", at: [0, 0] },
  ],
};

const arm = {
  v: SCENE_FORMAT_VERSION,
  name: "arm",
  bounds: [0, 0, 30, 20],
  entities: [
    { id: "tip", type: "marker", parent: "arm", at: [1.5, 0] },
    { id: "arm", type: "node", at: [10, 5], rot: 90 },
    { id: "plank", type: "solid", parent: "arm", shape: ["box", 0, 0, 1, 0.1] },
    { id: "hand", type: "node", parent: "arm", at: [2, 0] },
    { id: "finger", type: "marker", parent: "hand", at: [0.5, 0] },
    { id: "tilt", type: "node", at: [20, 10], rot: 30, flip: true },
    { id: "far", type: "marker", parent: "tilt", at: [2, 0] },
    { id: "a", type: "marker", parent: "b", at: [1, 1] },
    { id: "b", type: "marker", parent: "a", at: [2, 2] },
    { id: "lost", type: "marker", parent: "ghost", at: [3, 3] },
    { id: "plain", type: "marker", at: [4, 4] },
  ],
  instances: [{ id: "k", prefab: "kit", at: [3, 0], parent: "arm" }],
};

let root: string;
let ctx: ToolContext;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-show-tree-"));
  const dir = join(root, "trees");
  await mkdir(join(dir, "prefabs"), { recursive: true });
  await writeFile(join(dir, "prefabs", "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  await writeFile(join(dir, "arm.json"), `${JSON.stringify(arm, null, 2)}\n`);
  ctx = { projects: [await tempProject(dir, { id: "trees" })], loadRapier: loadCompatRapier };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function rows(input: Parameters<typeof show>[0] = {}) {
  const r = await show({ scene: "arm", ...input }, ctx);
  expect(r.exitCode, r.text).toBe(0);
  return { text: r.text, rows: (r.data as { entities: Row[] }).entities };
}

describe("scene show on parented entities", () => {
  it("prints each row's parent and the frame its geometry is stored in", async () => {
    const { rows: all, text } = await rows();
    const byRef = (ref: string) => all.find((r) => r.ref === ref);
    expect(byRef("arm")).not.toHaveProperty("parent");
    expect(byRef("arm")).not.toHaveProperty("origin");
    expect(byRef("tip")).toMatchObject({
      parent: "arm",
      at: [1.5, 0],
      origin: [10, 5],
      transform: { rot: 90, flip: false },
    });
    expect(byRef("tip")).not.toHaveProperty("extra");
    expect(byRef("finger")).toMatchObject({
      parent: "hand",
      at: [0.5, 0],
      origin: [10, 7],
      transform: { rot: 90, flip: false },
    });
    expect(byRef("far")).toMatchObject({
      parent: "tilt",
      origin: [20, 10],
      transform: { rot: 30, flip: true },
    });
    expect(byRef("k")).toMatchObject({
      type: "instance",
      parent: "arm",
      at: [10, 8],
      transform: { rot: 90, flip: false },
    });
    expect(byRef("k/pin")).toMatchObject({ instance: "k", parent: "k/hinge" });
    expect(text).toMatch(/^tip {2}marker parent arm at 1.5,0 m in 10,5 m rot 90$/m);
    expect(text).toMatch(/^far {2}marker parent tilt at 2,0 m in 20,10 m rot 30 flip$/m);
  });

  it("puts world boxes and --near through the parent chain", async () => {
    const { rows: all } = await rows();
    const plank = all.find((r) => r.ref === "plank")!;
    expect(plank).toMatchObject({ shape: ["box", 0, 0, 1, 0.1], origin: [10, 5] });
    expect(plank.aabb).toEqual({ minX: 9.9, minY: 4, maxX: 10.1, maxY: 6 });

    expect((await rows({ near: "10,6.5,0.01" })).rows.map((r) => r.ref)).toEqual(["tip"]);
    expect((await rows({ near: "10,7.5,0.01" })).rows.map((r) => r.ref)).toEqual(["finger"]);
    const far = (await rows({ near: `${20 - Math.sqrt(3)},9,0.01` })).rows.map((r) => r.ref);
    expect(far).toEqual(["far"]);
    // The kit's pin: hinge at [1, 0] in the instance at [3, 0] under the arm.
    const pin = (await rows({ near: "9,9,0.01" })).rows.map((r) => r.ref);
    expect(pin).toEqual(["k/pin"]);
  });

  it("reads a cycle and a missing parent leniently, as the resolver places them", async () => {
    const { rows: all } = await rows();
    const byRef = (ref: string) => all.find((r) => r.ref === ref);
    expect(byRef("a")).toMatchObject({ parent: "b", origin: [2, 2] });
    expect(byRef("b")).toMatchObject({ parent: "a" });
    expect(byRef("b")).not.toHaveProperty("origin");
    expect(byRef("lost")).toMatchObject({ parent: "ghost", at: [3, 3] });
    expect(byRef("lost")).not.toHaveProperty("origin");
  });

  it("lists rows depth first under their parents with --tree", async () => {
    const { rows: tree, text } = await rows({ tree: true });
    expect(tree.map((r) => [r.ref, r.depth])).toEqual([
      ["arm", 0],
      ["tip", 1],
      ["plank", 1],
      ["hand", 1],
      ["finger", 2],
      ["k", 1],
      ["k/hinge", 2],
      ["k/pin", 3],
      ["k/loose", 2],
      ["tilt", 0],
      ["far", 1],
      ["b", 0],
      ["a", 1],
      ["lost", 0],
      ["plain", 0],
    ]);
    expect(text).toMatch(/^ {2}tip {2}marker parent arm/m);
    expect(text).toMatch(/^ {6}k\/pin {2}marker parent k\/hinge/m);
    expect((await rows()).rows.every((r) => r.depth === undefined)).toBe(true);

    const filtered = await rows({ tree: true, type: "marker" });
    expect(filtered.rows.map((r) => [r.ref, r.depth])).toContainEqual(["finger", 2]);
  });
});
