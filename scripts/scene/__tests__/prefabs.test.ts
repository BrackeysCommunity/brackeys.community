// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RapierModule } from "@jams/engine/headless";
import { formatPrefab, formatScene, type Prefab, type SceneDefinition } from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { apply } from "../tools/apply";
import { list } from "../tools/list";
import { render } from "../tools/render";
import { show } from "../tools/show";
import { validate } from "../tools/validate";
import { tempProject } from "./fixtures";

const GATE: Prefab = {
  kind: "prefab",
  v: 3,
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
  v: 3,
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

/** Holds the project and, beside it, its dev cache. */
let tmp: string;
let root: string;
let ctx: ToolContext;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "scene-prefabs-"));
  root = join(tmp, "game");
  await mkdir(join(root, "prefabs"), { recursive: true });
  await writeFile(join(root, "prefabs", "gate.json"), formatPrefab(GATE));
  await writeFile(join(root, "gates.json"), formatScene(SCENE).text);
  ctx = {
    projects: [await tempProject(root, { id: "engine" })],
    loadRapier: () => import("@dimforge/rapier2d") as Promise<RapierModule>,
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
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

  it("reaches the v3 prefab ops from the CLI: params, variants, turns and z", async () => {
    const cli = async (...argv: string[]) => {
      const r = await runCli([...argv, "--json"], ctx);
      return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Record<string, unknown> };
    };
    const opsFile = async (name: string, batch: unknown) => {
      const file = join(tmp, name);
      await writeFile(file, JSON.stringify(batch));
      return file;
    };
    await writeFile(
      join(root, "prefabs", "red-gate.json"),
      formatPrefab({ kind: "prefab", v: 3, id: "red-gate", entities: [] }),
    );
    const header = await cli(
      "assets",
      "apply",
      "--ops",
      await opsFile("header.json", {
        v: 1,
        ops: [
          {
            op: "editScene",
            id: "gate",
            ops: [
              {
                op: "exposeParam",
                name: "speed",
                param: { description: "How fast the door moves.", targets: ["door.path.speed"] },
              },
            ],
          },
          { op: "editScene", id: "red-gate", ops: [{ op: "setPrefabBase", base: "gate" }] },
        ],
      }),
    );
    expect(header.exitCode, JSON.stringify(header.data)).toBe(0);
    const red = JSON.parse(
      await readFile(join(root, "prefabs", "red-gate.json"), "utf8"),
    ) as Prefab;
    expect(red.base).toBe("gate");
    const gate = JSON.parse(await readFile(join(root, "prefabs", "gate.json"), "utf8")) as Prefab;
    expect(Object.keys(gate.params ?? {})).toEqual(["speed"]);

    const scene = await cli(
      "apply",
      "gates",
      "--ops",
      await opsFile("scene.json", {
        ops: [
          { op: "setParam", ref: "gate-1", name: "speed", value: 150 },
          { op: "transform", refs: ["gate-1"], turn: 1 },
          { op: "setZ", refs: ["gate-1"], z: 2 },
          { op: "instantiate", instance: { id: "red-1", prefab: "red-gate", at: [700, 800] } },
        ],
      }),
    );
    expect(scene.exitCode, JSON.stringify(scene.data)).toBe(0);
    expect((await validate({ target: "gates" }, ctx)).exitCode).toBe(0);

    const rows = (await cli("show", "gates")).data.entities as (Record<string, unknown> & {
      ref: string;
    })[];
    const row = (ref: string) => rows.find((r) => r.ref === ref);
    expect(row("gate-1")).toMatchObject({
      params: { speed: 150 },
      exposes: ["speed"],
      transform: { rot: 1, flip: false },
      z: 2,
    });
    expect(row("gate-1/door")).toMatchObject({
      transform: { rot: 1, flip: false },
      z: 2,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 150 }) }),
    });
    expect(row("red-1")).toMatchObject({ prefab: "red-gate", exposes: ["speed"] });
    expect(row("red-1/door")).toMatchObject({ instance: "red-1", type: "follower" });
  });
});
