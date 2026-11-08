// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RapierModule } from "@jams/engine/headless";
import { formatPrefab, formatScene, type Prefab, type SceneDefinition } from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { apply } from "../tools/apply";
import { list } from "../tools/list";
import { render } from "../tools/render";
import { show } from "../tools/show";
import { validate } from "../tools/validate";
import { tempProject } from "./fixtures";

const GATE: Prefab = {
  kind: "prefab",
  v: 2,
  id: "gate",
  entities: [
    {
      id: "door",
      type: "follower",
      shape: ["box", 0, 0, 10, 40],
      path: {
        pts: [
          [0, 0],
          [0, -80],
        ],
        mode: "ping_pong",
        speed: 60,
      },
    },
    { id: "plank", type: "solid", attach: "door", shape: ["box", 30, -40, 20, 4] },
  ],
  bulk: { solid: [["box", 0, 50, 40, 6]] },
};

const SCENE: SceneDefinition = {
  v: 2,
  name: "gates",
  bounds: [0, 0, 2000, 1000],
  groups: { east: { at: [1000, 0] } },
  instances: [
    { id: "gate-1", prefab: "gate", at: [300, 800] },
    { id: "gate-2", prefab: "gate", group: "east", at: [300, 800] },
  ],
  solid: [["box", 1000, 980, 1000, 20]],
  entities: [{ id: "start", type: "marker", at: [100, 900], group: "east" }],
};

let root: string;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-prefabs-"));
  await mkdir(join(root, "prefabs"));
  await writeFile(join(root, "prefabs", "gate.json"), formatPrefab(GATE));
  await writeFile(join(root, "gates.json"), formatScene(SCENE).text);
  ctx = {
    projects: [await tempProject(root, { id: "engine" })],
    loadRapier: () => import("@dimforge/rapier2d") as Promise<RapierModule>,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scenes with prefabs", () => {
  it("validates against the prefabs beside the scene, physical checks included", async () => {
    const r = await validate({ target: "gates", physical: true }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    await rm(join(root, "prefabs", "gate.json"));
    const missing = await validate({ target: "gates" }, ctx);
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain("prefab-unknown");
  });

  it("lists instance children in the counts and renders them", async () => {
    const r = await list({}, ctx);
    const [scene] = (r.data as { scenes: { counts: Record<string, number> }[] }).scenes;
    expect(scene!.counts).toEqual({ solid: 5, follower: 2, marker: 1 });
    const svg = await render({ scene: "gates" }, ctx);
    expect(svg.exitCode).toBe(0);
    expect(svg.text).toContain("gate-2/door");
  });

  it("shows each instance, then its children in world coordinates", async () => {
    const r = await show({ scene: "gates" }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    const rows = (r.data as { entities: { ref: string }[] }).entities;
    const at = rows.findIndex((row) => row.ref === "gate-2");
    expect(rows[at]).toEqual({
      ref: "gate-2",
      type: "instance",
      prefab: "gate",
      at: [1300, 800],
      extra: { group: "east" },
    });
    expect(rows.slice(at + 1).map((row) => row.ref)).toEqual([
      "gate-2/door",
      "gate-2/plank",
      "gate-2/~solid:0",
    ]);
    expect(rows[at + 3]).toMatchObject({
      instance: "gate-2",
      type: "solid",
      aabb: { minX: 1260, minY: 844, maxX: 1340, maxY: 856 },
    });
    expect(r.text).toContain("gate-1  instance of gate at 300,800");
    const one = await show({ scene: "gates", ref: "gate-1/door" }, ctx);
    expect((one.data as { entities: unknown[] }).entities).toHaveLength(1);
  });

  it("writes a prefab change back to its file and the instances follow", async () => {
    const ops = join(root, "ops.json");
    await writeFile(
      ops,
      JSON.stringify({
        ops: [
          { op: "override", ref: "gate-1", set: { "door.path.speed": 140 } },
          { op: "applyToPrefab", ref: "gate-1" },
        ],
      }),
    );
    const r = await apply({ scene: "gates", ops }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    const prefab = JSON.parse(await readFile(join(root, "prefabs", "gate.json"), "utf8")) as Prefab;
    expect((prefab.entities[0]!.path as { speed: number }).speed).toBe(140);
    const scene = JSON.parse(await readFile(join(root, "gates.json"), "utf8")) as SceneDefinition;
    expect(scene.instances![0]!.overrides).toBeUndefined();
  });

  it("creates a prefab file from entries and unpacks it again", async () => {
    const ops = join(root, "ops.json");
    await writeFile(
      ops,
      JSON.stringify({ ops: [{ op: "createPrefab", refs: ["start"], id: "spawn-pad" }] }),
    );
    expect((await apply({ scene: "gates", ops }, ctx)).exitCode).toBe(0);
    expect((await readdir(join(root, "prefabs"))).sort()).toEqual(["gate.json", "spawn-pad.json"]);
    const scene = JSON.parse(await readFile(join(root, "gates.json"), "utf8")) as SceneDefinition;
    expect(scene.instances!.at(-1)).toEqual({
      id: "spawn-pad-1",
      prefab: "spawn-pad",
      at: [1100, 900],
    });
    await writeFile(ops, JSON.stringify({ ops: [{ op: "unpack", ref: "spawn-pad-1" }] }));
    expect((await apply({ scene: "gates", ops }, ctx)).exitCode).toBe(0);
    const back = JSON.parse(await readFile(join(root, "gates.json"), "utf8")) as SceneDefinition;
    expect(back.entities).toEqual([{ id: "start", type: "marker", at: [1100, 900] }]);
  });
});
