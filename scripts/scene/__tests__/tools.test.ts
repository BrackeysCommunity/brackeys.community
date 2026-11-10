// @vitest-environment node
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { RigidBody } from "@dimforge/rapier2d";
import { defineGame } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import {
  AGENT_SURFACE_KEYWORD,
  AGENT_SURFACE_VERSION,
  createRegistry,
  ISSUE_CODES,
  OP_NAMES,
  parseSceneOrThrow,
  sceneHash,
  type OpBatch,
} from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { platformerGame } from "../../../src/games/platformer";
import { COMMAND_NAMES, runCli } from "../commands";
import type { ToolContext } from "../context";
import { apply } from "../tools/apply";
import { check } from "../tools/check";
import { codes } from "../tools/codes";
import { diff } from "../tools/diff";
import { fmt } from "../tools/fmt";
import { fuzz } from "../tools/fuzz";
import { grid } from "../tools/grid";
import { list } from "../tools/list";
import { newScene } from "../tools/new";
import { playtest } from "../tools/playtest";
import { replay } from "../tools/replay";
import { schema } from "../tools/schema";
import { MAX_ROWS, show } from "../tools/show";
import { step } from "../tools/step";
import { validate } from "../tools/validate";
import { CARD_SPEED, CARD_TABLE, cardGame } from "./card-game";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const ENGINE_YARD = repoFile("src/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("src/engine/scenes/engine-yard.checks.json");
const ENGINE_SCENES = repoFile("src/engine/scenes");
const PREFAB_FIXTURES = repoFile("src/engine/scene/__tests__/fixtures/prefabs");
const NEW_OPS = [
  "transform",
  "setZ",
  "useAssets",
  "paintCells",
  "setPrefabBase",
  "exposeParam",
  "setParam",
];
const NEW_CODES = [
  "prefab-cycle",
  "prefab-depth",
  "variant-base-unknown",
  "param-unknown",
  "layer-unknown",
  "behavior-unknown",
  "behavior-forbidden",
  "behavior-missing",
  "grid-invalid",
  "ref-child-unknown",
];

const WALK = 300;

/** Walks the prop `avatar` left and right; its snapshot is the avatar's position. */
const avatarGame = defineGame({
  id: "avatar-game",
  types: [],
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime(ctx) {
    const held = new Set<string>();
    let avatar: RigidBody | null = null;
    return {
      onLoad() {
        const [handle] = ctx.tags.handlesOf("avatar");
        avatar =
          handle === undefined ? null : (ctx.physics!.world.getCollider(handle)?.parent() ?? null);
        avatar?.lockRotations(true, true);
      },
      beforeStep(_dt, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!avatar) return;
        const dir = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        avatar.setLinvel({ x: dir * WALK, y: avatar.linvel().y }, true);
      },
      snapshot() {
        if (!avatar) return null;
        const { x, y } = avatar.translation();
        return { x, y };
      },
    };
  },
});

const PLATFORMER = createRegistry(platformerGame);
const ENGINE = createRegistry();

let root: string;
let platformerDir: string;
let avatarDir: string;
let ctx: ToolContext;
let stdin = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-cli-"));
  platformerDir = join(root, "platformer");
  avatarDir = join(root, "avatar-game");
  await mkdir(platformerDir);
  await mkdir(avatarDir);
  await copyFile(TEST_YARD, join(platformerDir, "test-yard.json"));
  await copyFile(ENGINE_YARD, join(avatarDir, "engine-yard.json"));
  stdin = "";
  ctx = {
    projects: [
      await tempProject(platformerDir, { game: platformerGame }),
      await tempProject(avatarDir, { game: avatarGame }),
    ],
    loadRapier: () => import("@dimforge/rapier2d") as Promise<RapierModule>,
    readStdin: async () => stdin,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const yardText = () => readFile(join(platformerDir, "test-yard.json"), "utf8");
const engineYardText = () => readFile(join(avatarDir, "engine-yard.json"), "utf8");
type Rows = { entities: { ref: string; type: string }[] };
const refs = (data: unknown) => (data as Rows).entities.map((e) => e.ref);

describe("list", () => {
  it("lists every game's scenes with their game, hash, counts and bounds", async () => {
    const r = await list({}, ctx);
    expect(r.exitCode).toBe(0);
    const { scenes, clashes } = r.data as { scenes: Record<string, unknown>[]; clashes: object };
    expect(clashes).toEqual({});
    expect(scenes).toEqual([
      expect.objectContaining({
        name: "engine-yard",
        home: avatarGame.id,
        game: null,
        ok: true,
        sceneHash: sceneHash(parseSceneOrThrow(await engineYardText(), ENGINE)),
        counts: { solid: 4, sensor: 1, marker: 1, prop: 2, follower: 1 },
      }),
      expect.objectContaining({
        name: "test-yard",
        home: "platformer",
        game: "platformer",
        ok: true,
        sceneHash: sceneHash(parseSceneOrThrow(await yardText(), PLATFORMER)),
        bounds: [-2000, -500, 4000, 1200],
        counts: expect.objectContaining({ solid: 17, cloud: 3, mover: 3, anchor: 4, spawn: 1 }),
      }),
    ]);
    expect(r.text).toMatch(/^test-yard {2}platformer /m);
  });

  it("reports a name held by two projects, and refuses to pick one without --project", async () => {
    await copyFile(ENGINE_YARD, join(platformerDir, "engine-yard.json"));
    const r = await list({}, ctx);
    expect((r.data as { clashes: object }).clashes).toEqual({
      "engine-yard": [avatarGame.id, "platformer"],
    });
    const shown = await show({ scene: "engine-yard" }, ctx);
    expect(shown.exitCode).toBe(2);
    expect(shown.text).toContain("more than one project");
    const picked = await show({ scene: "engine-yard" }, { ...ctx, project: "platformer" });
    expect(picked.exitCode, picked.text).toBe(0);
    const cli = await runCli(["show", "engine-yard", "--project", "nope"], ctx);
    expect(cli.exitCode).toBe(2);
    expect(cli.stderr).toMatch(/no project "nope"/);
  });
});

describe("show", () => {
  it("prints the platformer's refs with derived geometry and filters", async () => {
    const all = await show({ scene: "test-yard" }, ctx);
    const data = all.data as Rows & { sceneHash: string; game: string; truncated: boolean };
    expect(data.sceneHash).toMatch(/^[0-9a-f]{16}$/);
    expect(data.game).toBe("platformer");
    expect(data.truncated).toBe(false);
    expect(data.entities[0]).toMatchObject({
      ref: "~solid:0",
      type: "solid",
      bulk: true,
      aabb: { minX: -2000, minY: 1020, maxX: 1490, maxY: 1060 },
      top: [-2000, 1490, 1020],
    });
    expect(data.entities).toContainEqual({
      ref: "~spawn:0",
      type: "spawn",
      bulk: true,
      at: [960, 1020],
    });

    const lift = await show({ scene: "test-yard", ref: "elevator" }, ctx);
    expect((lift.data as Rows).entities).toEqual([
      expect.objectContaining({
        ref: "elevator",
        type: "mover",
        aabb: { minX: 1260, minY: 994, maxX: 1340, maxY: 1006 },
        extra: expect.objectContaining({ path: expect.objectContaining({ speed: 100 }) }),
      }),
    ]);

    const movers = await show({ scene: "test-yard", type: "mover" }, ctx);
    expect(refs(movers.data)).toEqual(["pit-shuttle", "elevator", "diagonal"]);
    expect(refs((await show({ scene: "test-yard", near: "500,800,20" }, ctx)).data)).toContain(
      "cheese",
    );
    expect((await show({ scene: "test-yard", ref: "nope" }, ctx)).exitCode).toBe(1);
    expect((await show({ scene: "test-yard", near: "1,2" }, ctx)).exitCode).toBe(2);
  });

  it("prints the time model and the physics backend, with time and physics in JSON", async () => {
    const yard = await show({ scene: "test-yard" }, ctx);
    expect(yard.text.split("\n")[1]).toBe("time fixed 60Hz; physics rapier");
    expect(yard.data).toMatchObject({
      time: { kind: "fixed", rate: 60, catchUp: null, wakeOnPointerMove: false },
      physics: "rapier",
    });

    const tally = await show({ scene: "tally-yard" }, await tallyCtx());
    expect(tally.exitCode, tally.text).toBe(0);
    expect(tally.text.split("\n")[1]).toBe(
      "time turns 60Hz catch-up 1000ms; physics none, no wasm",
    );
    expect(tally.data).toMatchObject({
      time: { kind: "turns", rate: 60, catchUp: { maxMs: 1000 } },
      physics: "none",
    });
    await rm(join(root, tallyGame.id), { recursive: true, force: true });

    const project = await show(
      { scene: "tally-yard" },
      await tallyCtx({ tickRate: 30, physics: "rapier" }),
    );
    expect(project.text.split("\n")[1]).toBe(
      "time turns 30Hz catch-up 1000ms; physics none, no wasm",
    );
    const settings = JSON.parse(await engineYardText()) as Record<string, unknown>;
    await writeFile(
      join(avatarDir, "engine-yard.json"),
      JSON.stringify({ ...settings, settings: { physics: "none" } }),
    );
    const free = await show({ scene: "engine-yard" }, ctx);
    expect(free.data).toMatchObject({ physics: "none", time: { kind: "fixed" } });
  });

  it("shows a gameless scene with the engine's types, by name or file", async () => {
    const r = await show({ scene: "engine-yard" }, ctx);
    expect(r.exitCode).toBe(0);
    const data = r.data as Rows & { game: null; settings: unknown };
    expect(data.game).toBeNull();
    expect(data.settings).toEqual({ gravity: [0, 1200] });
    expect(data.entities).toContainEqual(
      expect.objectContaining({
        ref: "lift",
        type: "follower",
        aabb: { minX: 1640, minY: 892, maxX: 1760, maxY: 908 },
      }),
    );
    expect(data.entities).toContainEqual({
      ref: "start",
      type: "marker",
      at: [300, 960],
      extra: { tags: ["spawn"] },
    });
    expect(refs((await show({ scene: ENGINE_YARD }, ctx)).data)).toEqual(refs(data));
  });

  it("refuses a type the scene's game doesn't register and suggests refs", async () => {
    const typo = await show({ scene: "test-yard", type: "movers" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "mover"');
    expect((await show({ scene: "engine-yard", type: "mover" }, ctx)).exitCode).toBe(2);

    const miss = await show({ scene: "test-yard", ref: "elevater" }, ctx);
    expect(miss.exitCode).toBe(1);
    expect(miss.text).toContain("did you mean elevator?");
  });

  it("places a group member's AABB and --near in world space, keeping its stored geometry", async () => {
    const yard = JSON.parse(await engineYardText());
    yard.name = "grouped";
    yard.groups = { shelf: { at: [1000, 500] } };
    yard.entities.push(
      { id: "board", type: "solid", group: "shelf", shape: ["box", 0, 0, 100, 10] },
      { id: "pin", type: "marker", group: "shelf", at: [40, -20] },
    );
    await writeFile(join(avatarDir, "grouped.json"), JSON.stringify(yard));
    const data = (await show({ scene: "grouped", ref: "board" }, ctx)).data as Rows;
    expect(data.entities).toEqual([
      expect.objectContaining({
        shape: ["box", 0, 0, 100, 10],
        origin: [1000, 500],
        aabb: { minX: 900, minY: 490, maxX: 1100, maxY: 510 },
        top: [900, 1100, 490],
      }),
    ]);
    const near = refs((await show({ scene: "grouped", near: "1040,480,5" }, ctx)).data);
    expect(near).toEqual(["pin"]);
  });

  it("shows a nested instance's children as a/b/c with z, turns, params and exposed params", async () => {
    await cp(PREFAB_FIXTURES, join(avatarDir, "prefabs"), { recursive: true });
    const yard = JSON.parse(await engineYardText());
    yard.name = "rooms";
    yard.instances = [
      { id: "room-1", prefab: "room", at: [1000, 400], z: 1 },
      { id: "red-1", prefab: "red-gate", at: [400, 400], flip: true, params: { speed: 120 } },
    ];
    await writeFile(join(avatarDir, "rooms.json"), JSON.stringify(yard));
    const r = await show({ scene: "rooms" }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    type Row = Record<string, unknown> & { ref: string };
    const rows = (r.data as { entities: Row[] }).entities;
    const byRef = (ref: string) => rows.find((row) => row.ref === ref);

    expect(byRef("room-1")).toMatchObject({
      type: "instance",
      prefab: "room",
      at: [1000, 400],
      z: 1,
      nested: ["gate-1", "gate-2", "door-1", "door-1/latch"],
    });
    expect(byRef("room-1")).not.toHaveProperty("transform");
    expect(byRef("room-1/door-1/latch/door")).toMatchObject({
      type: "follower",
      instance: "room-1",
      instancePath: ["room-1", "door-1", "latch"],
      z: 3,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 30 }) }),
    });
    expect(byRef("room-1/door-1/panel")).toMatchObject({
      instancePath: ["room-1", "door-1"],
      z: 3,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 50 }) }),
    });
    expect(byRef("room-1/gate-2/door")).toMatchObject({
      transform: { rot: 2, flip: true },
      z: 1,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 90 }) }),
    });
    expect(byRef("room-1/lamp")).not.toHaveProperty("instancePath");

    expect(byRef("red-1")).toMatchObject({
      prefab: "red-gate",
      transform: { rot: 0, flip: true },
      params: { speed: 120 },
      exposes: ["speed"],
    });
    expect(byRef("red-1")).not.toHaveProperty("extra");
    expect(byRef("red-1/door")).toMatchObject({
      transform: { rot: 0, flip: true },
      z: 1,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 120 }) }),
    });

    const one = await show({ scene: "rooms", ref: "room-1/door-1/latch/door" }, ctx);
    expect(refs(one.data)).toEqual(["room-1/door-1/latch/door"]);
    expect(r.text).toContain("room-1  instance of room at 1000,400 z 1");
    expect(r.text).toContain("nests gate-1,gate-2,door-1,door-1/latch");
    expect(r.text).toMatch(
      /^red-1 {2}instance of red-gate at 400,400 turn 0 flip .*exposes speed/m,
    );
    expect(r.text).toMatch(/^room-1\/gate-2\/door .* turn 2 flip z 1/m);
  });

  it("summarises grid fields and lists behaviors and z, after paintCells and setZ", async () => {
    const dir = join(root, cardGame.id);
    await mkdir(dir);
    await writeFile(
      join(dir, "card-sink.json"),
      JSON.stringify({
        v: 3,
        game: cardGame.id,
        name: "card-sink",
        bounds: [0, 0, 2000, 1000],
        settings: { grid: { cell: [32, 32], kind: "square" } },
        entities: [
          { id: "lamp", type: "lamp", at: [200, 900], behaviors: { "card-game/glow": {} } },
          {
            id: "spinner",
            type: "lamp",
            z: 1,
            at: [400, 900],
            behaviors: {
              "card-game/glow": { color: "#00ccff" },
              "card-game/flicker": { rate: 6 },
            },
          },
          {
            id: "floor",
            type: "tiles",
            layer: "decor",
            at: [0, 640],
            cells: { "-1,0": ["0*31,3"], "0,0": ["1*32", "1*32", "0*4,2*24"], "1,0": ["1*8"] },
          },
        ],
      }),
    );
    const withGame: ToolContext = {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: cardGame })],
    };
    const shown = async () => {
      const r = await show({ scene: "card-sink" }, withGame);
      expect(r.exitCode, r.text).toBe(0);
      const rows = (r.data as { entities: (Record<string, unknown> & { ref: string })[] }).entities;
      return { text: r.text, row: (ref: string) => rows.find((e) => e.ref === ref) };
    };
    const before = await shown();
    expect(before.row("floor")).toMatchObject({
      type: "tiles",
      at: [0, 640],
      grids: { cells: { cells: 97, chunks: 3, bounds: { c0: -1, r0: 0, c1: 39, r1: 2 } } },
      extra: { layer: "decor" },
    });
    expect(before.row("spinner")).toEqual({
      ref: "spinner",
      type: "lamp",
      at: [400, 900],
      z: 1,
      behaviors: {
        "card-game/glow": { color: "#00ccff" },
        "card-game/flicker": { rate: 6 },
      },
    });
    expect(before.text).toContain("floor  tiles at 0,640 cells 97 cells -1,0..39,2");
    expect(before.text).toContain(
      "spinner  lamp at 400,900 z 1 behaviors card-game/glow,card-game/flicker",
    );

    const ops = join(root, "paint.json");
    await writeFile(
      ops,
      JSON.stringify({
        ops: [
          { op: "paintCells", ref: "floor", field: "cells", rects: [[0, 10, 3, 11, 2]] },
          { op: "setZ", refs: ["lamp"], z: 4 },
        ],
      }),
    );
    const applied = await apply({ scene: "card-sink", ops }, withGame);
    expect(applied.exitCode, applied.text).toBe(0);
    const after = await shown();
    expect(after.row("floor")).toMatchObject({
      grids: { cells: { cells: 105, bounds: { c0: -1, r0: 0, c1: 39, r1: 11 } } },
    });
    expect(after.row("lamp")).toMatchObject({ z: 4 });
  });

  it("caps its rows and says so", async () => {
    const yard = JSON.parse(await yardText());
    yard.name = "big";
    yard.solid = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ["box", i * 30, 1000, 10, 10]);
    yard.bounds = [-2000, -500, 10000, 1200];
    await writeFile(join(platformerDir, "big.json"), JSON.stringify(yard));
    const data = (await show({ scene: "big" }, ctx)).data as Rows & {
      truncated: boolean;
      total: number;
    };
    expect(data.truncated).toBe(true);
    expect(data.entities).toHaveLength(MAX_ROWS);
    expect(data.total).toBeGreaterThan(MAX_ROWS);
  });
});

describe("schema and codes", () => {
  it("serves every schema it names, fragment, prefab and the project schemas included", async () => {
    const usage = await runCli(["schema", "nope"], ctx);
    expect(usage.exitCode).toBe(2);
    for (const which of ["scene", "ops", "script", "checks", "recording", "fragment", "prefab"])
      expect(usage.stderr).toContain(which);
    const ids: Record<string, string> = {
      project: "urn:jams-engine:project:v1",
      "asset-sidecar": "urn:jams-engine:asset-sidecar:v1",
      "project-ops": "urn:jams-engine:project-ops:v1",
      "project-snapshot": "urn:jams-engine:project-snapshot:v1",
      material: "urn:jams-engine:material:v1",
      "game-settings": "urn:jams-engine:game-settings:v1",
      "data-table": "urn:jams-engine:data-table:v1",
      "input-script": "urn:jams-engine:input-script:v1",
    };
    for (const [which, id] of Object.entries(ids)) {
      const r = await schema({ which }, ctx);
      expect(r.exitCode, which).toBe(0);
      expect((r.data as { $id: string }).$id, which).toBe(id);
      expect(usage.stderr.includes(which) || which === "input-script", which).toBe(true);
    }
    const scoped = await schema({ which: "scene" }, { ...ctx, project: "platformer" });
    expect((scoped.data as { $id: string }).$id).toBe(PLATFORMER.schemaId);
    expect(
      (await schema({ which: "scene", game: avatarGame.id }, { ...ctx, project: "platformer" }))
        .exitCode,
    ).toBe(2);
  });

  it("prints the engine's or a game's schemas and refuses others", async () => {
    expect((await schema({}, ctx)).data).toMatchObject({ $id: "urn:jams-engine:scene:v3" });
    for (const which of ["prefab", "fragment"]) {
      expect((await schema({ which }, ctx)).data, which).toMatchObject({
        $id: `urn:jams-engine:${which}:v3`,
      });
      expect((await schema({ which, game: "platformer" }, ctx)).data, which).toMatchObject({
        $id: `urn:jams-engine:${which}:platformer:v3`,
      });
    }
    expect((await schema({ which: "ops" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:ops:v3",
    });
    expect((await schema({ game: "platformer" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:scene:platformer:v3",
    });
    expect((await schema({ which: "ops", game: "platformer" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:ops:platformer:v3",
    });
    expect((await schema({ which: "scripts" }, ctx)).exitCode).toBe(2);
    const typo = await schema({ game: "platformr" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "platformer"');
  });

  it("codes groups the engine's codes and each game's", async () => {
    const result = (await codes({}, ctx)).data as {
      agentSurface: number;
      codes: Record<string, Record<string, unknown>>;
    };
    expect(result.agentSurface).toBe(AGENT_SURFACE_VERSION);
    const data = result.codes;
    expect(Object.keys(data)).toEqual(["engine", "platformer", avatarGame.id]);
    expect(data.engine).toEqual(ISSUE_CODES);
    expect(Object.keys(data.platformer!)).toContain("platformer/no-goal");
    expect(Object.keys(data.platformer!).every((c) => c.startsWith("platformer/"))).toBe(true);
    expect(data[avatarGame.id]).toEqual({});
    const listed = (await codes({}, ctx)).text;
    for (const code of NEW_CODES) {
      expect(data.engine, code).toHaveProperty(code);
      expect(listed, code).toMatch(new RegExp(`^  ${code} +error `, "m"));
    }
  });

  it("reaches every op the format adds through the ops schema", async () => {
    const text = JSON.stringify((await schema({ which: "ops" }, ctx)).data);
    for (const op of NEW_OPS) {
      expect(OP_NAMES, op).toContain(op);
      expect(text, op).toContain(`"const":"${op}"`);
    }
  });

  it("schema carries the agent surface version", async () => {
    const data = (await schema({ which: "ops", game: "platformer" }, ctx)).data as Record<
      string,
      unknown
    >;
    expect(data[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
  });
});

describe("diff", () => {
  const ops = (batch: OpBatch) => {
    stdin = JSON.stringify(batch);
    return "-";
  };

  it("compares two scenes, with no changes for a scene and its copy", async () => {
    const same = await diff({ a: "engine-yard", b: ENGINE_YARD }, ctx);
    expect(same.exitCode).toBe(0);
    expect(same.data).toMatchObject({ ok: true, changed: false, changes: [] });

    const other = await diff({ a: "engine-yard", b: "test-yard" }, ctx);
    expect(other.exitCode).toBe(0);
    const changes = (other.data as { changes: { kind: string; field?: string }[] }).changes;
    expect(changes).toContainEqual(expect.objectContaining({ kind: "scene", field: "game" }));
    expect(changes).toContainEqual(expect.objectContaining({ kind: "removed", ref: "lift" }));
  });

  it("previews an op batch without writing", async () => {
    const before = await engineYardText();
    const r = await diff(
      { a: "engine-yard", ops: ops({ ops: [{ op: "rename", from: "lift", to: "elevator" }] }) },
      ctx,
    );
    expect(r.exitCode).toBe(0);
    expect((r.data as { changes: unknown[] }).changes).toEqual([
      { kind: "renamed", from: "lift", to: "elevator" },
    ]);
    expect(await engineYardText()).toBe(before);
  });

  it("diffs against a git revision as the old side", async () => {
    const old = await engineYardText();
    const withGit: ToolContext = {
      ...ctx,
      gitShow: async (file, rev) => {
        expect(file).toBe(join(avatarDir, "engine-yard.json"));
        expect(rev).toBe("HEAD~1");
        return old;
      },
    };
    await apply(
      {
        scene: "engine-yard",
        ops: ops({ ops: [{ op: "update", ref: "lift", set: { "path.speed": 120 } }] }),
      },
      withGit,
    );
    const r = await diff({ a: "engine-yard", git: "HEAD~1" }, withGit);
    expect(r.exitCode).toBe(0);
    expect((r.data as { changes: unknown[] }).changes).toEqual([
      { kind: "modified", ref: "lift", field: "path.speed", from: 80, to: 120 },
    ]);
    const failing: ToolContext = { ...ctx, gitShow: () => Promise.reject(new Error("bad rev")) };
    expect((await diff({ a: "engine-yard", git: "nope" }, failing)).exitCode).toBe(1);
  });

  it("exits 1 on a missing scene, 2 on usage and 3 on a stale base", async () => {
    expect((await diff({ a: "nope", b: "engine-yard" }, ctx)).exitCode).toBe(1);
    expect((await diff({ a: "engine-yard" }, ctx)).exitCode).toBe(2);
    expect((await diff({ a: "engine-yard", b: "test-yard", git: "HEAD" }, ctx)).exitCode).toBe(2);
    const stale = ops({
      base: "0000000000000000",
      ops: [{ op: "remove", refs: ["~solid:0"] }],
    });
    expect((await diff({ a: "engine-yard", ops: stale }, ctx)).exitCode).toBe(3);
  });
});

describe("new", () => {
  it("writes a game's template with a $schema that resolves", async () => {
    const withSchemas: ToolContext = {
      ...ctx,
      schemaFiles: { platformer: repoFile("src/games/platformer/scene.schema.json") },
    };
    const r = await newScene({ name: "fresh", game: "platformer" }, withSchemas);
    expect(r.exitCode, r.text).toBe(0);
    const text = await readFile(join(platformerDir, "fresh.json"), "utf8");
    const def = parseSceneOrThrow(text, PLATFORMER);
    expect(def).toMatchObject({ game: "platformer", name: "fresh", v: 3 });
    expect(join(platformerDir, def.$schema!)).toBe(
      repoFile("src/games/platformer/scene.schema.json"),
    );
    expect((await validate({ target: "fresh" }, ctx)).data).toMatchObject({
      counts: { error: 0, warn: 0, info: 0 },
    });
    expect((await fmt({ scene: "fresh", check: true }, ctx)).exitCode).toBe(0);
  });

  it("copies another scene under a new name, keeping its game", async () => {
    const r = await newScene({ name: "yard-2", from: "test-yard" }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    const copy = parseSceneOrThrow(
      await readFile(join(platformerDir, "yard-2.json"), "utf8"),
      PLATFORMER,
    );
    const original = parseSceneOrThrow(await yardText(), PLATFORMER);
    expect(copy.name).toBe("yard-2");
    expect(copy.entities).toEqual(original.entities);
    expect(copy.$schema).toBe(original.$schema);
  });

  it("writes a gameless scene into the engine home", async () => {
    const engineDir = join(root, "engine");
    const withEngine: ToolContext = {
      ...ctx,
      projects: [...ctx.projects, await tempProject(engineDir, { id: "engine" })],
    };
    const r = await newScene({ name: "blank" }, withEngine);
    expect(r.exitCode, r.text).toBe(0);
    expect(
      parseSceneOrThrow(await readFile(join(engineDir, "blank.json"), "utf8"), ENGINE),
    ).toEqual({
      v: 3,
      name: "blank",
      bounds: [0, 0, 1920, 1080],
    });
    expect((await newScene({ name: "blank-2" }, ctx)).exitCode).toBe(1);
  });

  it("exits 1 on a taken name and 2 on usage", async () => {
    expect((await newScene({ name: "test-yard", game: "platformer" }, ctx)).exitCode).toBe(1);
    expect((await newScene({ name: "engine-yard", game: "platformer" }, ctx)).exitCode).toBe(1);
    expect((await newScene({}, ctx)).exitCode).toBe(2);
    expect((await newScene({ name: "a/b.json" }, ctx)).exitCode).toBe(2);
    expect((await newScene({ name: "Bad Name", game: "platformer" }, ctx)).exitCode).toBe(2);
    expect((await newScene({ name: "x", game: "nope" }, ctx)).exitCode).toBe(2);
    expect(
      (await newScene({ name: "x", from: "test-yard", game: avatarGame.id }, ctx)).exitCode,
    ).toBe(2);
  });
});

describe("new in a project with other assets", { timeout: 60_000 }, () => {
  let deck: string;
  let deckCtx: ToolContext;

  /** Every file under `dir` with its bytes, by relative path. */
  async function tree(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      out[relative(dir, path)] = (await readFile(path)).toString("base64");
    }
    return out;
  }

  beforeEach(async () => {
    deck = join(root, "deck");
    await cp(ENGINE_SCENES, deck, { recursive: true });
    deckCtx = { ...ctx, projects: [await tempProject(deck, { id: "deck" })] };
  });

  it.each(["game-settings", "bouncy"])(
    "refuses %s, an id another kind's asset holds, and writes nothing",
    async (name) => {
      const before = await tree(deck);
      const r = await newScene({ name }, deckCtx);
      expect(r.exitCode, r.text).toBe(1);
      expect(r.data).toMatchObject({
        ok: false,
        written: false,
        issue: { code: "asset-id-taken" },
      });
      expect(await tree(deck)).toEqual(before);
    },
  );

  it("creates a free name as a scene asset of the project", async () => {
    const r = await newScene({ name: "annex" }, deckCtx);
    expect(r.exitCode, r.text).toBe(0);
    expect(
      parseSceneOrThrow(await readFile(join(deck, "annex.json"), "utf8"), ENGINE),
    ).toMatchObject({ name: "annex", v: 3 });
    const listed = await runCli(["assets", "list", "--kind", "scene", "--json"], deckCtx);
    expect(
      (JSON.parse(listed.stdout) as { assets: { id: string }[] }).assets.map((a) => a.id),
    ).toContain("annex");
  });
});

describe("validate", () => {
  it("judges each scene by its game", async () => {
    const yard = await validate({ target: "test-yard" }, ctx);
    expect(yard.exitCode).toBe(0);
    expect(yard.data).toMatchObject({ ok: true, game: "platformer", counts: { error: 0 } });

    const engine = await validate({ target: "engine-yard" }, ctx);
    expect(engine.exitCode).toBe(0);
    expect(engine.data).toMatchObject({ ok: true, game: null, counts: { error: 0 } });
    expect((await validate({ target: ENGINE_YARD }, ctx)).exitCode).toBe(0);
  });

  it("reports an unknown game, and a game type in a gameless scene", async () => {
    const other = join(root, "other.json");
    await writeFile(
      other,
      (await yardText()).replace('"game": "platformer"', '"game": "platformr"'),
    );
    const r = await validate({ target: other }, ctx);
    expect(r.exitCode).toBe(1);
    const [issue] = (r.data as { issues: { code: string; message: string }[] }).issues;
    expect(issue).toMatchObject({ code: "unknown-game" });
    expect(issue!.message).toContain('did you mean "platformer"');

    const gameless = join(root, "gameless.json");
    await writeFile(gameless, (await yardText()).replace('  "game": "platformer",\n', ""));
    const codes = (
      (await validate({ target: gameless }, ctx)).data as { issues: { code: string }[] }
    ).issues.map((i) => i.code);
    expect(codes).toContain("unknown-key");
  });

  it("fails a broken file with lines and refuses bad names", async () => {
    const bad = join(root, "bad.json");
    await writeFile(
      bad,
      (await yardText()).replace('["box", 700, 940, 80, 8]', '["box", 700, 940, 80]'),
    );
    const r = await validate({ target: bad }, ctx);
    expect(r.exitCode).toBe(1);
    const [issue] = (r.data as { issues: { code: string; line?: number }[] }).issues;
    expect(issue).toMatchObject({ code: "bad-shape", line: 23 });

    expect((await validate({ target: "../etc/passwd" }, ctx)).exitCode).toBe(1);
    const byFile = await validate({ target: "test-yard.json" }, ctx);
    expect(byFile.exitCode).toBe(1);
    expect(byFile.text).toContain("pass its name: test-yard");
    expect((await validate({ target: "Bad Name" }, ctx)).exitCode).toBe(2);
    expect((await validate({}, ctx)).exitCode).toBe(2);
  });

  it("--physical adds the physics world's issues, exit 1 only on errors", async () => {
    type Validated = {
      physical: boolean;
      counts: Record<string, number>;
      issues: { code: string; line?: number }[];
    };
    const engine = await validate({ target: "engine-yard", physical: true }, ctx);
    expect(engine.exitCode).toBe(0);
    const data = engine.data as Validated;
    expect(data.physical).toBe(true);
    expect(data.issues.map((i) => i.code)).toEqual(["solid-overlap", "solid-overlap"]);
    expect(data.issues[0]!.line).toBeTypeOf("number");
    expect(engine.text).toContain("(physical)");

    const yard = await validate({ target: "test-yard", physical: true }, ctx);
    expect(yard.exitCode).toBe(0);
    expect((yard.data as Validated).issues.map((i) => i.code)).toContain("follower-hits-solid");
    expect((await validate({ target: "test-yard" }, ctx)).data).toMatchObject({ physical: false });

    const sunk = join(root, "sunk.json");
    await writeFile(sunk, (await yardText()).replace("[960, 1020]", "[960, 1040]"));
    const r = await runCli(["validate", sunk, "--physical", "--json"], ctx);
    expect(r.exitCode).toBe(1);
    const issues = (JSON.parse(r.stdout) as Validated).issues;
    expect(issues).toContainEqual(expect.objectContaining({ code: "platformer/spawn-in-solid" }));
  });
});

describe("fmt", () => {
  it("formats every doc kind through the kind's format, one by id or all of them", async () => {
    await copyFile(ENGINE_YARD_CHECKS, join(avatarDir, "engine-yard.checks.json"));
    const script = { v: 1, scene: "engine-yard", steps: [{ wait: 10 }] };
    await writeFile(join(avatarDir, "hop.script.json"), JSON.stringify(script, null, 8));
    const check = await fmt({ scene: "engine-yard-checks", check: true }, ctx);
    expect(check.data).toMatchObject({ asset: "engine-yard-checks", kind: "checks" });
    const all = await fmt({ check: true }, ctx);
    const rows = (all.data as { assets: { id: string; kind: string; changed?: boolean }[] }).assets;
    expect(rows.map((r) => [r.id, r.kind])).toEqual(
      expect.arrayContaining([
        ["engine-yard-checks", "checks"],
        ["hop-script", "input-script"],
        ["test-yard", "scene"],
      ]),
    );
    expect(rows.find((r) => r.id === "hop-script")?.changed).toBe(true);
    expect(all.exitCode).toBe(1);
    const written = await fmt({}, ctx);
    expect(written.exitCode, written.text).toBe(0);
    expect((await fmt({ check: true }, ctx)).exitCode).toBe(0);
    expect((await fmt({ scene: "hop-script", check: true }, ctx)).exitCode).toBe(0);
    expect((await fmt({ scene: "nope" }, ctx)).exitCode).toBe(1);
  });

  it("migrates a v2 prefab and a v2 scene to v3", async () => {
    await mkdir(join(avatarDir, "prefabs"));
    const v3 = await readFile(join(PREFAB_FIXTURES, "gate.json"), "utf8");
    const v2 = v3.replace('"v": 3,', '"v": 2,');
    expect(JSON.parse(v2)).toMatchObject({ kind: "prefab", v: 2 });
    await writeFile(join(avatarDir, "prefabs", "gate.json"), v2);
    const yard = JSON.parse(await engineYardText());
    await writeFile(
      join(avatarDir, "old-yard.json"),
      `${JSON.stringify({ ...yard, v: 2, name: "old-yard" }, null, 2)}\n`,
    );

    const checked = await fmt({ scene: "gate", check: true }, ctx);
    expect(checked.exitCode).toBe(1);
    expect(checked.data).toMatchObject({ asset: "gate", kind: "prefab", migratedFrom: 2 });
    expect(checked.text).toContain("from v2 to v3");

    const all = await fmt({ check: true }, ctx);
    const rows = (all.data as { assets: { id: string; migratedFrom?: number }[]; migrated: number })
      .assets;
    expect(
      rows
        .filter((r) => r.migratedFrom === 2)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["gate", "old-yard"]);
    expect((all.data as { migrated: number }).migrated).toBe(2);

    const written = await fmt({}, ctx);
    expect(written.exitCode, written.text).toBe(0);
    expect(written.text).toContain("gate (prefab): formatted (from v2 to v3)");
    const prefab = JSON.parse(await readFile(join(avatarDir, "prefabs", "gate.json"), "utf8"));
    expect(prefab).toMatchObject({ kind: "prefab", v: 3, id: "gate" });
    expect(prefab.entities).toEqual(JSON.parse(v2).entities);
    expect(JSON.parse(await readFile(join(avatarDir, "old-yard.json"), "utf8")).v).toBe(3);
    const again = await fmt({ scene: "gate", check: true }, ctx);
    expect(again.exitCode, again.text).toBe(0);
    expect(again.data).not.toHaveProperty("migratedFrom");
  });

  it("--check reports and fmt rewrites to canonical text in the scene's own directory", async () => {
    expect((await fmt({ scene: "test-yard", check: true }, ctx)).exitCode).toBe(0);
    expect((await fmt({ scene: "engine-yard", check: true }, ctx)).exitCode).toBe(0);
    const yard = JSON.parse(await yardText());
    await writeFile(join(platformerDir, "messy.json"), JSON.stringify(yard));
    expect((await fmt({ scene: "messy", check: true }, ctx)).exitCode).toBe(1);
    expect((await fmt({ scene: "messy" }, ctx)).data).toMatchObject({ changed: true });
    expect(await readFile(join(platformerDir, "messy.json"), "utf8")).toBe(await yardText());
    expect((await fmt({ scene: ENGINE_YARD }, ctx)).exitCode).toBe(2);
  });
});

describe("apply", () => {
  it("--dry-run returns the diff and writes nothing, on both yards", async () => {
    const before = await yardText();
    await writeFile(
      join(root, "ops.json"),
      JSON.stringify({ ops: [{ op: "update", ref: "elevator", set: { "path.speed": 140 } }] }),
    );
    const r = await apply({ scene: "test-yard", ops: join(root, "ops.json"), dryRun: true }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({
      ok: true,
      written: false,
      diff: [{ kind: "modified", ref: "elevator", field: "path.speed", from: 100, to: 140 }],
    });
    expect(r.data).not.toHaveProperty("def");
    expect(await yardText()).toBe(before);

    const engineBefore = await engineYardText();
    stdin = JSON.stringify({
      ops: [{ op: "add", entity: { id: "pad", type: "sensor", shape: ["box", 500, 950, 20, 10] } }],
    });
    const added = await apply({ scene: "engine-yard", ops: "-", dryRun: true }, ctx);
    expect(added.exitCode).toBe(0);
    expect(added.data).toMatchObject({ ok: true, written: false, created: ["pad"] });
    expect(await engineYardText()).toBe(engineBefore);

    stdin = JSON.stringify({
      ops: [{ op: "add", entity: { id: "c", type: "cloud", shape: ["box", 500, 950, 20, 10] } }],
    });
    expect((await apply({ scene: "engine-yard", ops: "-", dryRun: true }, ctx)).exitCode).toBe(1);
  });

  it("writes canonical text, reads stdin, and returns 3 for a stale base", async () => {
    const batch: OpBatch = { ops: [{ op: "rename", from: "plank", to: "seesaw" }] };
    stdin = JSON.stringify(batch);
    const r = await apply({ scene: "test-yard", ops: "-" }, ctx);
    expect(r.exitCode).toBe(0);
    const text = await yardText();
    expect(text).toContain('"id": "seesaw"');
    expect((await fmt({ scene: "test-yard", check: true }, ctx)).exitCode).toBe(0);

    stdin = JSON.stringify({
      base: "0000000000000000",
      ops: [{ op: "remove", refs: ["~solid:3"] }],
    });
    const stale = await apply({ scene: "test-yard", ops: "-" }, ctx);
    expect(stale.exitCode).toBe(3);
    expect(stale.data).toMatchObject({ ok: false, issue: { code: "stale-base" } });
    expect(await yardText()).toBe(text);

    stdin = JSON.stringify({ ops: [{ op: "remove", refs: ["missing"] }] });
    expect((await apply({ scene: "test-yard", ops: "-" }, ctx)).exitCode).toBe(1);
    expect((await apply({ scene: "test-yard" }, ctx)).exitCode).toBe(2);
  });
});

describe("apply judges sprites against the scene's project", { timeout: 60_000 }, () => {
  let sink: string;
  let sinkCtx: ToolContext;

  beforeEach(async () => {
    sink = join(root, "engine");
    await cp(ENGINE_SCENES, sink, { recursive: true });
    sinkCtx = { ...ctx, projects: [await tempProject(sink, { id: "engine" })] };
  });

  const sinkText = () => readFile(join(sink, "kitchen-sink.json"), "utf8");
  const codesOf = (data: unknown) =>
    (data as { issues: { code: string }[] }).issues.map((i) => i.code);

  it("refuses an unknown atlas frame, and writes nothing", async () => {
    const before = await sinkText();
    stdin = JSON.stringify({
      ops: [{ op: "update", ref: "crate", set: { "behaviors.sprite.frame": "crate-9" } }],
    });
    for (const dryRun of [true, false]) {
      const r = await apply({ scene: "kitchen-sink", ops: "-", dryRun }, sinkCtx);
      expect(r.exitCode, r.text).toBe(1);
      expect(r.data).toMatchObject({ written: false });
      expect(codesOf(r.data)).toContain("asset-frame-unknown");
    }
    expect(await sinkText()).toBe(before);
  });

  it("warns of a sprite with no asset, and still writes", async () => {
    stdin = JSON.stringify({
      ops: [{ op: "update", ref: "crate", unset: ["behaviors.sprite.asset"] }],
    });
    const dry = await apply({ scene: "kitchen-sink", ops: "-", dryRun: true }, sinkCtx);
    expect(dry.exitCode, dry.text).toBe(0);
    expect(codesOf(dry.data)).toEqual(["sprite-no-asset"]);
    const wrote = await apply({ scene: "kitchen-sink", ops: "-" }, sinkCtx);
    expect(wrote.exitCode, wrote.text).toBe(0);
    expect(wrote.data).toMatchObject({ written: true });
  });
});

/** A physics-free turns game that counts `bump`s and keeps a log of the commands it stepped. */
const tallyGame = defineGame({
  id: "tally-game",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Unused." }],
  time: { kind: "turns", catchUp: { maxMs: 1000 } },
  commands: {
    bump: { description: "Adds n.", args: z.strictObject({ n: z.number().int() }) },
    reset: { description: "Back to zero." },
  },
  createRuntime() {
    let tick = 0;
    let count = 0;
    let away = 0;
    const log: string[] = [];
    return {
      beforeStep(_dt, _actions, commands) {
        for (const c of commands) {
          log.push(`${tick}:${c.name}`);
          if (c.name === "bump") count += (c.args as { n: number }).n;
          else if (c.name === "reset") count = 0;
          else if (c.name === "@elapsed") away += (c.args as { ms: number }).ms;
        }
        tick++;
      },
      snapshot: () => ({ count, away, log: [...log] }),
    };
  },
});

const TALLY_YARD = {
  v: 1,
  name: "tally-yard",
  game: tallyGame.id,
  bounds: [0, 0, 320, 240],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [16, 16] }],
};

/** `ctx` plus the tally game's project holding tally-yard; loading Rapier fails the test. */
async function tallyCtx(engine?: Record<string, unknown>): Promise<ToolContext> {
  const dir = join(root, tallyGame.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tally-yard.json"), JSON.stringify(TALLY_YARD, null, 2));
  if (engine) {
    await writeFile(
      join(dir, "game-settings.json"),
      JSON.stringify({ kind: "game-settings", v: 1, engine, game: {} }),
    );
  }
  return {
    ...ctx,
    projects: [...ctx.projects, await tempProject(dir, { game: tallyGame })],
    loadRapier: () => Promise.reject(new Error("a physics-free run loaded Rapier")),
  };
}

describe("step", () => {
  type StepData = {
    game: string | null;
    sceneHash: string;
    ticks: number;
    configHash: string;
    final: unknown;
    events: { type: string; tick: number; entityId?: string; other?: string }[];
  };

  it("runs the platformer and reports its snapshot and events", async () => {
    const r = await step({ scene: "test-yard", ticks: "120", hold: "move_right" }, ctx);
    expect(r.exitCode).toBe(0);
    const data = r.data as StepData & { final: { position: { x: number } } };
    expect(data).not.toHaveProperty("landings");
    expect(data.game).toBe("platformer");
    expect(data.sceneHash).toBe(sceneHash(parseSceneOrThrow(await yardText(), PLATFORMER)));
    expect(data.configHash).toMatch(/^[0-9a-f]{16}$/);
    expect(data.ticks).toBe(120);
    expect(data.final.position.x).toBeGreaterThan(960);
    expect(data.events).toContainEqual(
      expect.objectContaining({ type: "landed", entityId: "~solid:0" }),
    );
    expect(r.text).toContain('final {"position":');

    await writeFile(
      join(root, "in.json"),
      JSON.stringify([
        [5, "jump", 1],
        [20, "jump", 0],
      ]),
    );
    const jumped = await step(
      { scene: "test-yard", ticks: "30", inputs: join(root, "in.json") },
      ctx,
    );
    expect((jumped.data as StepData).events).toContainEqual(
      expect.objectContaining({ type: "left-ground", tick: 5 }),
    );
  });

  it("steps a gameless scene under a chosen game", async () => {
    const r = await step(
      { scene: "engine-yard", ticks: "120", hold: "right", game: avatarGame.id },
      ctx,
    );
    expect(r.exitCode).toBe(0);
    const data = r.data as StepData & { final: { x: number; y: number } };
    expect(data.game).toBe(avatarGame.id);
    expect(data.final.x).toBeGreaterThan(800);
    expect(data.final.y).toBeCloseTo(940, 0);
    expect(data.events).toContainEqual(
      expect.objectContaining({ type: "sensor:enter", entityId: "zone", other: "avatar" }),
    );

    const bare = await step({ scene: "engine-yard", ticks: "10" }, ctx);
    expect(bare.data).toMatchObject({ game: null, final: null, ticks: 10 });
    expect((bare.data as StepData).configHash).not.toBe(data.configHash);
    expect((await step({ scene: ENGINE_YARD, ticks: "10" }, ctx)).exitCode).toBe(0);
  });

  it("steps --elapse and --command on their ticks, time away before a tick's commands", async () => {
    const tally = await tallyCtx();
    const r = await step(
      {
        scene: "tally-yard",
        ticks: "10",
        command: ['2:bump={"n":3}', "5:reset", '7:bump={"n":4}'],
        elapse: ["2:5000"],
      },
      tally,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({
      game: tallyGame.id,
      ticks: 10,
      commands: [
        [2, "@elapsed", { ms: 1000 }],
        [2, "bump", { n: 3 }],
        [5, "reset"],
        [7, "bump", { n: 4 }],
      ],
      final: { count: 4, away: 1000, log: ["2:@elapsed", "2:bump", "5:reset", "7:bump"] },
    });
    expect(r.text).toContain('  t2 command @elapsed {"ms":1000}\n  t2 command bump {"n":3}');
    expect(r.text).toContain("  t5 command reset");

    const one = await step({ scene: "tally-yard", ticks: "3", command: "1:reset" }, tally);
    expect(one.data).toMatchObject({ commands: [[1, "reset"]], final: { log: ["1:reset"] } });
    expect((await step({ scene: "tally-yard", ticks: "3" }, tally)).data).toMatchObject({
      commands: [],
      final: { log: [] },
    });
  });

  it("refuses a bad --command or --elapse with the playtest's message", async () => {
    const tally = await tallyCtx();
    const refused = async (input: { command?: string[]; elapse?: string[] }) => {
      const r = await step({ scene: "tally-yard", ticks: "10", ...input }, tally);
      expect(r.exitCode, r.text).toBe(2);
      return r.text;
    };
    expect(await refused({ command: ["2:bum"] })).toContain(
      '--command 2:bum: unknown command "bum"; did you mean "bump"?',
    );
    expect(await refused({ command: ["2:bump"] })).toContain("--command 2:bump: bad args for bump");
    expect(await refused({ command: ['2:bump={"n":1.5}'] })).toContain("bad args for bump");
    expect(await refused({ command: ["2:reset={}"] })).toContain("reset takes no args");
    expect(await refused({ command: ["2:bump={n:1}"] })).toContain("args are not JSON");
    expect(await refused({ command: ["2:@elapsed"] })).toContain("send it with an elapse step");
    expect(await refused({ command: ["reset"] })).toContain("expected tick:name[=json]");
    expect(await refused({ command: ["-1:reset"] })).toContain("with a whole tick");
    expect(await refused({ command: ["10:reset"] })).toContain(
      "tick 10 is past the run's last (9)",
    );
    expect(await refused({ elapse: ["3:soon"] })).toContain("--elapse 3:soon:");
    expect(await refused({ elapse: ["3"] })).toContain("expected tick:ms");

    const fixed = await step({ scene: "test-yard", ticks: "10", elapse: ["1:500"] }, ctx);
    expect(fixed.exitCode).toBe(2);
    expect(fixed.text).toContain("--elapse 1:500: elapse needs the game's time.catchUp");
    const gameless = await step({ scene: "engine-yard", ticks: "10", command: ["1:reset"] }, ctx);
    expect(gameless.text).toContain("(commands: none)");
  });

  it("takes repeated --command and --elapse flags on the command line", async () => {
    const tally = await tallyCtx();
    const r = await runCli(
      [
        "step",
        "tally-yard",
        "--ticks",
        "6",
        "--command",
        '1:bump={"n":2}',
        '--command=3:bump={"n":5}',
        "--elapse",
        "4:20",
        "--json",
      ],
      tally,
    );
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      commands: [
        [1, "bump", { n: 2 }],
        [3, "bump", { n: 5 }],
        [4, "@elapsed", { ms: 20 }],
      ],
      final: { count: 7, away: 20 },
    });
    const bad = await runCli(["step", "tally-yard", "--command", "1:bum"], tally);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain('did you mean "bump"');
  });

  it("refuses bad ticks, unknown actions and games, and --game on a game's scene", async () => {
    expect((await step({ scene: "test-yard", ticks: "0" }, ctx)).exitCode).toBe(2);
    const typo = await step({ scene: "test-yard", hold: "move_rihgt" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "move_right"');
    const avatarTypo = await step({ scene: "engine-yard", hold: "rght", game: avatarGame.id }, ctx);
    expect(avatarTypo.text).toContain('did you mean "right"');
    expect((await step({ scene: "engine-yard", hold: "right" }, ctx)).text).toContain(
      "actions: none",
    );

    await writeFile(join(root, "typo-in.json"), JSON.stringify([[5, "jmup", 1]]));
    expect(
      (await step({ scene: "test-yard", inputs: join(root, "typo-in.json") }, ctx)).exitCode,
    ).toBe(2);
    await writeFile(join(root, "bad-in.json"), JSON.stringify([[5, "jump"]]));
    expect(
      (await step({ scene: "test-yard", inputs: join(root, "bad-in.json") }, ctx)).exitCode,
    ).toBe(2);

    expect((await step({ scene: "engine-yard", game: "nope" }, ctx)).exitCode).toBe(2);
    const clash = await step({ scene: "test-yard", game: avatarGame.id }, ctx);
    expect(clash.exitCode).toBe(2);
    expect(clash.text).toContain('is for game "platformer"');
  });
});

/** The avatar game with play hooks: it wins when the avatar enters `zone`. */
const goalGame = defineGame({
  ...avatarGame,
  id: "goal-game",
  play: {
    focus: (s) => (s ? { x: (s as { x: number }).x, y: (s as { y: number }).y } : null),
    movementActions: ["left", "right"],
    results: ["won"],
    outcome: ({ events }) =>
      events.some((e) => e.type === "sensor:enter" && e.entityId === "zone" && e.other === "avatar")
        ? { result: "won", entityId: "zone" }
        : null,
  },
});

/** `ctx` plus the goal game, with engine-yard copied in as one of its scenes (`goal-yard`). */
async function goalCtx(): Promise<ToolContext> {
  const dir = join(root, goalGame.id);
  await mkdir(dir);
  const yard = JSON.parse(await engineYardText()) as Record<string, unknown>;
  await writeFile(
    join(dir, "goal-yard.json"),
    JSON.stringify({ ...yard, name: "goal-yard", game: goalGame.id }),
  );
  return { ...ctx, projects: [...ctx.projects, await tempProject(dir, { game: goalGame })] };
}

const HOP_LEFT = repoFile("scripts/scene/examples/hop-left.json");

describe("playtest", () => {
  type Played = {
    game: string | null;
    blocked: boolean;
    sceneHash: string;
    outcome: { result: string; tick: number; at: { x: number; y: number } | null };
    ticks: number;
    steps: { index: number; end: string }[];
    events: { type: string; entityId?: string }[];
    final: { position: { x: number; y: number }; groundId?: string };
    stage?: string;
    scriptIssues?: { path: string; message: string }[];
  };

  it("plays the example script on test-yard and reports steps, events and the outcome", async () => {
    const r = await playtest({ scene: "test-yard", script: HOP_LEFT }, ctx);
    expect(r.exitCode).toBe(0);
    const data = r.data as Played;
    expect(data).toMatchObject({ game: "platformer", blocked: false });
    expect(data.sceneHash).toBe(sceneHash(parseSceneOrThrow(await yardText(), PLATFORMER)));
    expect(data.outcome.result).toBe("script-end");
    expect(data.steps.map((s) => s.end)).toEqual(["done", "done", "until", "done"]);
    expect(data.events).toContainEqual(
      expect.objectContaining({ type: "landed", entityId: "~solid:7" }),
    );
    expect(data.final.groundId).toBe("~solid:7");
    expect(r.text).toContain("script-end at t");
    expect(r.text).toContain("step 2 t44");

    const from = await playtest({ scene: "test-yard", script: HOP_LEFT, at: "300,600" }, ctx);
    expect((from.data as Played).final.position.x).toBeLessThan(300);
  });

  it("reports the game's outcome, reading the script from stdin", async () => {
    const goal = await goalCtx();
    stdin = JSON.stringify({ v: 1, steps: [{ hold: ["right"], until: { tick: 1000 } }] });
    const r = await runCli(["playtest", "goal-yard", "--script", "-", "--json"], goal);
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout) as Played;
    expect(data.game).toBe(goalGame.id);
    expect(data.outcome).toMatchObject({ result: "won" });
    expect(data.steps).toEqual([expect.objectContaining({ index: 0, end: "run" })]);
  });

  it("exits 1 on a blocked run and 2 on usage", async () => {
    await writeFile(join(root, "typo.json"), JSON.stringify({ v: 1, steps: [{ press: "jum" }] }));
    const typo = await playtest({ scene: "test-yard", script: join(root, "typo.json") }, ctx);
    expect(typo.exitCode).toBe(1);
    expect((typo.data as Played).stage).toBe("script");
    expect(typo.text).toContain('did you mean "jump"');

    const inside = await playtest({ scene: "test-yard", script: HOP_LEFT, at: "1200,700" }, ctx);
    expect(inside.exitCode).toBe(1);
    expect(inside.data).toMatchObject({ stage: "load", load: { reason: "spawn-blocked" } });

    await writeFile(
      join(root, "elsewhere.json"),
      JSON.stringify({ v: 1, scene: "other-yard", steps: [{ wait: 1 }] }),
    );
    const elsewhere = await playtest(
      { scene: "test-yard", script: join(root, "elsewhere.json") },
      ctx,
    );
    expect(elsewhere.exitCode).toBe(1);
    expect((elsewhere.data as Played).scriptIssues?.[0]?.path).toBe("/scene");

    await writeFile(join(root, "broken.json"), "{ v: 1");
    const broken = await playtest({ scene: "test-yard", script: join(root, "broken.json") }, ctx);
    expect(broken.exitCode).toBe(1);
    expect(broken.text).toContain("not JSON");

    expect((await playtest({ scene: "test-yard" }, ctx)).exitCode).toBe(2);
    expect(
      (await playtest({ scene: "test-yard", script: HOP_LEFT, at: "1,2,3" }, ctx)).exitCode,
    ).toBe(2);
    expect((await playtest({ scene: "-", script: "-" }, ctx)).exitCode).toBe(2);
    expect(
      (await playtest({ scene: "test-yard", script: join(root, "nope.json") }, ctx)).exitCode,
    ).toBe(1);
  });
});

describe("playtest in a project with data", () => {
  async function cardCtx(settings: Record<string, unknown>): Promise<ToolContext> {
    const dir = join(root, cardGame.id);
    await mkdir(join(dir, "data"), { recursive: true });
    const yard = JSON.parse(await engineYardText()) as Record<string, unknown>;
    await writeFile(
      join(dir, "card-yard.json"),
      JSON.stringify({ ...yard, name: "card-yard", game: cardGame.id }),
    );
    await writeFile(
      join(dir, "data", "cards.json"),
      JSON.stringify({
        kind: "data-table",
        v: 1,
        table: CARD_TABLE,
        rows: [
          { id: "fireball", cost: 3, damage: 5 },
          { id: "heal", cost: 2 },
        ],
      }),
    );
    await writeFile(
      join(dir, "game-settings.json"),
      JSON.stringify({ kind: "game-settings", v: 1, engine: {}, game: settings }),
    );
    return { ...ctx, projects: [...ctx.projects, await tempProject(dir, { game: cardGame })] };
  }

  it("gives the game its project's table rows and settings", async () => {
    await writeFile(
      join(root, "walk.json"),
      JSON.stringify({ v: 1, steps: [{ hold: ["right"], for: 60 }] }),
    );
    const run = (c: ToolContext) =>
      playtest({ scene: "card-yard", script: join(root, "walk.json") }, c);

    const fast = await run(await cardCtx({ avatarSpeed: CARD_SPEED * 2 }));
    expect(fast.exitCode, fast.text).toBe(0);
    const data = fast.data as { events: { type: string; entityId?: string }[] };
    expect(data.events.filter((e) => e.type === "card").map((e) => e.entityId)).toEqual([
      "fireball",
      "heal",
    ]);
    expect(fast.text).toContain("card fireball");

    await rm(join(root, cardGame.id), { recursive: true, force: true });
    const slow = await run(await cardCtx({}));
    expect(slow.exitCode, slow.text).toBe(0);
    const x = (r: typeof fast) =>
      (r.data as { final: { position: { x: number } } }).final.position.x;
    const start = 300;
    expect(x(fast) - start).toBeGreaterThan(1.5 * (x(slow) - start));
  });
});

describe("a scene without physics", () => {
  const WAIT_SCRIPT = { v: 1, steps: [{ wait: 30 }] };
  const FREE_YARD = {
    v: 1,
    name: "free-yard",
    bounds: [0, 0, 640, 480],
    entities: [
      { id: "start", type: "marker", at: [100, 100], tags: ["spawn"] },
      { id: "zone", type: "sensor", shape: ["box", 300, 300, 40, 40] },
    ],
  };

  /** A project holding free-yard, physics-free through its own settings or the project's; loading Rapier fails the test. */
  async function freeCtx(
    where: "scene" | "project",
    extra: Record<string, unknown>[] = [],
  ): Promise<ToolContext & { loads: () => number }> {
    const dir = join(root, "free");
    await mkdir(dir, { recursive: true });
    const yard = {
      ...FREE_YARD,
      ...(where === "scene" ? { settings: { physics: "none" } } : {}),
      entities: [...FREE_YARD.entities, ...extra],
    };
    await writeFile(join(dir, "free-yard.json"), JSON.stringify(yard, null, 2));
    await writeFile(
      join(dir, "free-yard.checks.json"),
      JSON.stringify({
        v: 1,
        checks: [
          { id: "valid", kind: "valid", physical: true },
          { id: "ends", kind: "reaches", result: "script-end", script: WAIT_SCRIPT },
        ],
      }),
    );
    if (where === "project") {
      await writeFile(
        join(dir, "game-settings.json"),
        JSON.stringify({ kind: "game-settings", v: 1, engine: { physics: "none" }, game: {} }),
      );
    }
    let loads = 0;
    return {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir)],
      loadRapier: () => {
        loads++;
        return Promise.reject(new Error("a physics-free run loaded Rapier"));
      },
      loads: () => loads,
    };
  }

  const WAIT = async () => {
    const file = join(root, "wait.json");
    await writeFile(file, JSON.stringify(WAIT_SCRIPT));
    return file;
  };

  for (const where of ["scene", "project"] as const) {
    it(`playtest, step, validate and check never load Rapier (physics "none" from the ${where})`, async () => {
      const free = await freeCtx(where);
      const played = await runCli(
        ["playtest", "free-yard", "--script", await WAIT(), "--json"],
        free,
      );
      expect(played.exitCode, played.stdout).toBe(0);
      expect(JSON.parse(played.stdout)).toMatchObject({ blocked: false, game: null });
      const stepped = await runCli(["step", "free-yard", "--ticks", "30", "--json"], free);
      expect(stepped.exitCode, stepped.stdout).toBe(0);
      expect(JSON.parse(stepped.stdout)).toMatchObject({ ticks: 30, load: { ok: true } });
      const physical = await validate({ target: "free-yard", physical: true }, free);
      expect(physical.exitCode, physical.text).toBe(0);
      const checked = await check({ scene: "free-yard" }, free);
      expect(checked.exitCode, checked.text).toBe(0);
      const results = (checked.data as { results: { pass: boolean }[] }).results;
      expect(results.length).toBe(2);
      expect(results.every((r) => r.pass)).toBe(true);
      expect(free.loads()).toBe(0);
    });
  }

  for (const where of ["scene", "project"] as const) {
    it(`replay and fuzz never load Rapier (physics "none" from the ${where})`, async () => {
      const free = await freeCtx(where);
      const rec = join(root, "free.rec.json");
      const played = await playtest(
        { scene: "free-yard", script: await WAIT(), record: rec },
        free,
      );
      expect(played.exitCode, played.text).toBe(0);
      const replayed = await replay({ scene: "free-yard", run: rec }, free);
      expect(replayed.exitCode, replayed.text).toBe(0);
      expect(replayed.data).toMatchObject({ matches: true });
      const fuzzed = await fuzz({ scene: "free-yard", rollouts: "2", ticks: "30" }, free);
      expect(fuzzed.exitCode, fuzzed.text).toBe(0);
      expect(free.loads()).toBe(0);
    });
  }

  it("a prop fails validation with physics-required, whichever level says none", async () => {
    const crate = {
      id: "crate",
      type: "prop",
      shape: ["box", 200, 200, 20, 20],
      density: 1,
      restitution: 0,
    };
    for (const where of ["scene", "project"] as const) {
      const free = await freeCtx(where, [crate]);
      const r = await validate({ target: "free-yard" }, free);
      expect(r.exitCode).toBe(1);
      const issues = (r.data as { issues: { code: string; entityIds: string[] }[] }).issues;
      expect(issues.filter((i) => i.code === "physics-required")).toEqual([
        expect.objectContaining({ entityIds: ["crate"] }),
      ]);
      await rm(join(root, "free"), { recursive: true, force: true });
    }
  });

  it("a Rapier scene still loads Rapier", async () => {
    let loads = 0;
    const counted: ToolContext = {
      ...ctx,
      loadRapier: () => {
        loads++;
        return ctx.loadRapier();
      },
    };
    expect((await step({ scene: "test-yard", ticks: "1" }, counted)).exitCode).toBe(0);
    expect(loads).toBe(1);
  });
});

describe("replay", () => {
  it("records a playtest with --record and replays it to the same end", async () => {
    const file = join(root, "hop.rec.json");
    const played = await playtest({ scene: "test-yard", script: HOP_LEFT, record: file }, ctx);
    expect(played.exitCode).toBe(0);
    const r = await replay({ scene: "test-yard", run: file }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({ game: "platformer", matches: true, stale: false, warnings: [] });
    expect(r.text).toContain("test-yard: replays: script-end");

    await writeFile(join(root, "report.json"), JSON.stringify(played.data));
    expect(
      (await replay({ scene: "test-yard", run: join(root, "report.json") }, ctx)).exitCode,
    ).toBe(0);
  });

  it("exits 1 when a replay diverges or is blocked, and 2 on usage", async () => {
    const file = join(root, "hop2.rec.json");
    await playtest({ scene: "test-yard", script: HOP_LEFT, record: file }, ctx);
    const recording = JSON.parse(await readFile(file, "utf8")) as { end: string };
    await writeFile(
      join(root, "tampered.json"),
      JSON.stringify({ ...recording, end: "0000000000000000" }),
    );
    const diverged = await replay({ scene: "test-yard", run: join(root, "tampered.json") }, ctx);
    expect(diverged.exitCode).toBe(1);
    expect(diverged.text).toContain("diverges");

    await writeFile(join(root, "notrec.json"), JSON.stringify({ v: 9 }));
    const bad = await replay({ scene: "test-yard", run: join(root, "notrec.json") }, ctx);
    expect(bad.exitCode).toBe(1);
    expect(bad.data).toMatchObject({ blocked: true, stage: "script" });

    expect((await replay({ scene: "test-yard" }, ctx)).exitCode).toBe(2);
    expect((await replay({ scene: "-", run: "-" }, ctx)).exitCode).toBe(2);
  });
});

describe("fuzz", () => {
  type Fuzzed = {
    game: string | null;
    seed: number | string;
    rollouts: number;
    touched: { ref: string; reached: number; firstTick: number }[];
    untouched: string[];
    results: Record<string, number>;
    timing?: { ticksPerSecond: number };
  };
  const withoutTiming = (data: unknown) => {
    const { timing, ...rest } = data as Fuzzed;
    expect(timing!.ticksPerSecond).toBeGreaterThan(0);
    return rest;
  };

  it("reports what seeded rollouts touched on test-yard, the same for the same seed", async () => {
    const r = await fuzz({ scene: "test-yard", rollouts: "4", ticks: "120" }, ctx);
    expect(r.exitCode).toBe(0);
    const data = r.data as Fuzzed;
    expect(data).toMatchObject({ game: "platformer", seed: 1, rollouts: 4 });
    expect(data.touched.find((t) => t.ref === "~solid:0")?.reached).toBeGreaterThan(0);
    expect(data.untouched).toContain("hole");
    expect(Object.values(data.results).reduce((a, b) => a + b, 0)).toBe(4);
    expect(r.text).toMatch(/~solid:0 \(solid\) reached in \d of 4 runs, first at t\d+/);
    const again = await fuzz({ scene: "test-yard", rollouts: "4", ticks: "120" }, ctx);
    expect(withoutTiming(again.data)).toEqual(withoutTiming(r.data));
    const named = await fuzz({ scene: "test-yard", rollouts: "2", ticks: "60", seed: "dawn" }, ctx);
    expect((named.data as Fuzzed).seed).toBe("dawn");
  });

  it("counts the game's results and steps a gameless scene", async () => {
    const goal = await goalCtx();
    const r = await runCli(
      ["fuzz", "goal-yard", "--rollouts", "8", "--ticks", "300", "--json"],
      goal,
    );
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout) as Fuzzed;
    expect(data.results.won).toBeGreaterThan(0);
    expect(data.touched.find((t) => t.ref === "zone")?.reached).toBe(data.results.won);
    const bare = await fuzz({ scene: "engine-yard", rollouts: "2", ticks: "30" }, ctx);
    expect(bare.data).toMatchObject({ game: null, results: { timeout: 2 } });
  });

  it("refuses bad counts", async () => {
    expect((await fuzz({ scene: "test-yard", rollouts: "0" }, ctx)).exitCode).toBe(2);
    expect((await fuzz({ scene: "test-yard", ticks: "many" }, ctx)).exitCode).toBe(2);
    expect((await fuzz({ scene: "nope" }, ctx)).exitCode).toBe(1);
  });
});

describe("schema script", () => {
  it("prints the engine's or a game's input-script schema", async () => {
    const engine = await schema({ which: "script" }, ctx);
    expect(engine.data).toMatchObject({ $id: "urn:jams-engine:input-script:v1" });
    const game = await runCli(["schema", "script", "--game", "platformer", "--json"], ctx);
    const parsed = JSON.parse(game.stdout) as {
      $id: string;
      $defs: { Action: { enum: string[] } };
    };
    expect(parsed.$id).toBe("urn:jams-engine:input-script:platformer:v1");
    expect(parsed.$defs.Action.enum).toContain("move_right");
  });
});

describe("check", () => {
  type Checked = {
    ok: boolean;
    game: string | null;
    checks: string;
    results: { id: string; pass: boolean; skipped?: string; message: string }[];
    issues?: { path: string; line?: number; message: string }[];
  };
  const ids = (data: unknown) => (data as Checked).results.map((r) => [r.id, r.pass]);

  it("runs the checks file beside a scene, by name or path", async () => {
    await copyFile(ENGINE_YARD_CHECKS, join(avatarDir, "engine-yard.checks.json"));
    const r = await check({ scene: "engine-yard" }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({ ok: true, game: null });
    expect((r.data as Checked).checks).toBe(join(avatarDir, "engine-yard.checks.json"));
    expect(ids(r.data)).toEqual([
      ["valid", true],
      ["settles", true],
      ["times-out", true],
    ]);
    expect(r.text).toMatch(/^engine-yard no game: 3 passed, 0 failed, 0 skipped/);
    expect(r.text).toContain("  pass settles (reaches) ended script-end");

    const byPath = await check({ scene: join(avatarDir, "engine-yard.json") }, ctx);
    expect(byPath.exitCode).toBe(0);
    const only = await check({ scene: "engine-yard", only: "settles" }, ctx);
    expect(ids(only.data)).toEqual([["settles", true]]);
    const typo = await check({ scene: "engine-yard", only: "setles" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "settles"');
  });

  it("exits 1 on a failing check, a game's result under --game, and a skip", async () => {
    const goal = await goalCtx();
    await writeFile(
      join(root, "to-zone.json"),
      JSON.stringify({ v: 1, steps: [{ hold: ["right"], for: 600 }] }),
    );
    const file = join(root, "yard.checks.json");
    await writeFile(
      file,
      JSON.stringify({
        v: 1,
        checks: [
          { id: "win", kind: "reaches", script: "to-zone.json", result: "won" },
          { id: "stand", kind: "reaches", script: { v: 1, steps: [{ wait: 30 }] }, result: "won" },
          { id: "zone", kind: "touches", entity: "zone", atLeast: 1, rollouts: 8, ticks: 300 },
          { id: "later", kind: "valid", max: "warn", skip: "not yet" },
        ],
      }),
    );
    const r = await runCli(
      ["check", "engine-yard", "--checks", file, "--game", goalGame.id, "--json"],
      goal,
    );
    expect(r.exitCode).toBe(1);
    const data = JSON.parse(r.stdout) as Checked;
    expect(data.game).toBe(goalGame.id);
    expect(data.results.map((c) => [c.id, c.pass])).toEqual([
      ["win", true],
      ["stand", false],
      ["zone", true],
      ["later", true],
    ]);
    expect(data.results[1]!.message).toBe("ended script-end at t29, not won");
    expect(data.results[3]!.skipped).toBe("not yet");

    const text = await check({ scene: "engine-yard", checks: file, game: goalGame.id }, goal);
    expect(text.text).toMatch(/2 passed, 1 failed, 1 skipped/);
    expect(text.text).toContain("  FAIL stand (reaches)");
  });

  it("reports a missing or invalid checks file, and refuses --game on a game's scene", async () => {
    const missing = await check({ scene: "test-yard" }, ctx);
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain("No checks file at");

    const bad = join(root, "bad.checks.json");
    await writeFile(bad, JSON.stringify({ v: 1, checks: [{ id: "a", kind: "reachs" }] }, null, 2));
    const invalid = await check({ scene: "test-yard", checks: bad }, ctx);
    expect(invalid.exitCode).toBe(1);
    expect((invalid.data as Checked).issues?.[0]).toMatchObject({
      path: "/checks/0/kind",
      line: 6,
    });
    expect(invalid.text).toContain('did you mean "reaches"');

    expect((await check({ scene: "test-yard", game: avatarGame.id }, ctx)).exitCode).toBe(2);
    expect((await check({}, ctx)).exitCode).toBe(2);
  });
});

describe("--game on playtest and fuzz", () => {
  it("plays and fuzzes a gameless scene under a chosen game", async () => {
    const goal = await goalCtx();
    await writeFile(
      join(root, "right.json"),
      JSON.stringify({ v: 1, steps: [{ hold: ["right"], for: 600 }] }),
    );
    const played = await playtest(
      { scene: "engine-yard", script: join(root, "right.json"), game: goalGame.id },
      goal,
    );
    expect(played.exitCode).toBe(0);
    expect(played.data).toMatchObject({ game: goalGame.id, outcome: { result: "won" } });
    const fuzzed = await fuzz(
      { scene: "engine-yard", rollouts: "4", ticks: "300", game: goalGame.id },
      goal,
    );
    expect(fuzzed.data).toMatchObject({ game: goalGame.id });
    expect((await fuzz({ scene: "engine-yard", game: "nope" }, goal)).exitCode).toBe(2);
    const clash = await playtest(
      { scene: "test-yard", script: join(root, "right.json"), game: goalGame.id },
      goal,
    );
    expect(clash.exitCode).toBe(2);
  });
});

describe("grid", () => {
  /** A gameless physics-free scene on a 6×3 square grid: `start` at [0, 0], `exit` at [5, 0], a wall down column 2. */
  const yard = (wallRows: 2 | 3, settings: Record<string, unknown> = SQUARE) => ({
    v: 3,
    name: "grid-yard",
    bounds: [0, 0, 192, 96],
    settings: { physics: "none", grid: settings },
    solid: [["box", 80, 16 * wallRows, 16, 16 * wallRows]],
    entities: [
      { id: "start", type: "marker", at: [16, 16] },
      { id: "exit", type: "marker", at: [176, 16] },
    ],
  });
  const SQUARE = { kind: "square", cell: [32, 32] };
  const noRapier: () => ToolContext = () => ({
    ...ctx,
    loadRapier: () => Promise.reject(new Error("scene grid loaded Rapier")),
  });
  const write = async (scene: unknown) => {
    const file = join(root, "grid-yard.json");
    await writeFile(file, JSON.stringify(scene, null, 2));
    return file;
  };

  it("prints a square grid's walls, the path between two entities and a field of view", async () => {
    const file = await write(yard(2));
    const r = await grid(
      { scene: file, from: "start", to: "exit", fov: "0,2:3", diagonals: false },
      noRapier(),
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toBe(
      [
        "grid-yard grid square 32×32: cells [0, 0]..[5, 2] (6×3), 2 walls",
        "walls (# wall, . open)",
        "  ..#...",
        "  ..#...",
        "  ......",
        "path start [0, 0] → exit [5, 0]: 9 steps, cost 90 (* path, A from, B to)",
        "  A*#.*B",
        "  .*#**.",
        "  .***..",
        "fov [0, 2] radius 3: 10 cells visible (@ origin, # wall, . open, blank unseen)",
        "  ..#",
        "  ..#",
        "  @...",
      ].join("\n"),
    );
    const json = await runCli(
      ["grid", file, "--from", "0,0", "--to", "5,0", "--diagonals", "--json"],
      noRapier(),
    );
    expect(json.exitCode, json.stdout).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.grid.walls).toEqual([
      [2, 0],
      [2, 1],
    ]);
    expect(data.path).toMatchObject({ from: [0, 0], to: [5, 0], diagonals: true });
    expect(data.path.cells[0]).toEqual([0, 0]);
    expect(data.path.cells.at(-1)).toEqual([5, 0]);
    expect(data.path.cost).toBeLessThan(90);
  });

  it("draws a hex grid in its stagger and finds a path on it", async () => {
    const hex = { kind: "hex", cell: [32, 32], side: 16, stagger: "y", index: "odd" };
    const file = await write(yard(2, hex));
    const r = await grid(
      { scene: file, from: "start", to: "exit", fov: "start:2", diagonals: false },
      noRapier(),
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toBe(
      [
        "grid-yard grid hex 32×32 side 16, stagger y odd: cells [-1, -1]..[5, 3] (7×5), 4 walls",
        "walls (# wall, . open)",
        "   . . . . . . .",
        "  . . . # . . .",
        "   . . # # . . .",
        "  . . . # . . .",
        "   . . . . . . .",
        "path start [0, 0] → exit [5, 0]: 6 steps, cost 60 (* path, A from, B to)",
        "   . . * * * * .",
        "  . A * # . . B",
        "   . . # # . . .",
        "  . . . # . . .",
        "   . . . . . . .",
        "fov start [0, 0] radius 2: 13 cells visible (@ origin, # wall, . open, blank unseen)",
        "   . . .",
        "  . @ . #",
        "   . . #",
        "  . . .",
        "",
      ].join("\n"),
    );
    const stagger = await grid(
      { scene: await write(yard(2, { ...hex, stagger: "x" })), diagonals: false },
      noRapier(),
    );
    expect(stagger.exitCode, stagger.text).toBe(0);
    expect(stagger.text.split("\n").slice(1)).toEqual([
      "walls (# wall, . open)",
      "   . . . .",
      "  . . # . .",
      "   . # . .",
      "  . . # . .",
      "   . # . .",
      "  . . # . .",
      "   . . . .",
      "  . . . . .",
    ]);
  });

  it("exits 1 with no path, naming the target", async () => {
    const file = await write(yard(3));
    const r = await runCli(["grid", file, "--from", "start", "--to", "exit", "--json"], noRapier());
    expect(r.exitCode).toBe(1);
    const data = JSON.parse(r.stdout);
    expect(data).toMatchObject({ ok: false, path: null });
    expect(data.issues).toEqual([
      expect.objectContaining({ code: "grid-unreachable", entityIds: ["exit"] }),
    ]);
    const text = await grid({ scene: file, from: "0,0", to: "5,2", diagonals: true }, noRapier());
    expect(text.exitCode).toBe(1);
    expect(text.text).toContain("no path from [0, 0] to [5, 2]");
  });

  it("reports grid-invalid without a grid, and refuses bad places", async () => {
    const { settings: _drop, ...gridless } = yard(2);
    const none = await grid({ scene: await write(gridless), diagonals: false }, noRapier());
    expect(none.exitCode).toBe(1);
    expect(none.data).toMatchObject({
      issues: [expect.objectContaining({ code: "grid-invalid" })],
    });
    const file = await write(yard(2));
    const typo = await grid(
      { scene: file, from: "strt", to: "exit", diagonals: false },
      noRapier(),
    );
    expect(typo.exitCode).toBe(1);
    expect(typo.text).toContain("did you mean start?");
    expect((await grid({ scene: file, from: "0,0", diagonals: false }, noRapier())).exitCode).toBe(
      2,
    );
    expect((await grid({ scene: file, fov: "0,0", diagonals: false }, noRapier())).exitCode).toBe(
      2,
    );
  });
});

describe("schema checks", () => {
  it("prints the engine's or a game's checks-file schema", async () => {
    const engine = await schema({ which: "checks" }, ctx);
    expect(engine.data).toMatchObject({
      $id: "urn:jams-engine:checks:v1",
      [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    });
    const game = await runCli(["schema", "checks", "--game", "platformer", "--json"], ctx);
    expect((JSON.parse(game.stdout) as { $id: string }).$id).toBe(
      "urn:jams-engine:checks:platformer:v1",
    );
  });
});

describe("textconv", () => {
  it("is a registered command", async () => {
    const r = await runCli(["textconv", join(avatarDir, "engine-yard.json")], ctx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("~solid:0 ");
    expect((await runCli(["textconv"], ctx)).exitCode).toBe(2);
  });
});

describe("runCli", () => {
  it("exposes the command table in COMMAND_NAMES", () => {
    expect(COMMAND_NAMES).toEqual([
      "list",
      "show",
      "schema",
      "codes",
      "validate",
      "fmt",
      "apply",
      "diff",
      "new",
      "step",
      "grid",
      "playtest",
      "replay",
      "fuzz",
      "check",
      "render",
      "textconv",
      "bundle",
      "project show",
      "project tree",
      "project refs",
      "project snapshot",
      "project pull",
      "project push",
      "assets list",
      "assets info",
      "assets import",
      "assets rename",
      "assets move",
      "assets delete",
      "assets restore",
      "assets change-id",
      "assets set-import",
      "assets apply",
    ]);
  });

  it("runs two-word commands and lists them in the help", async () => {
    const help = await runCli(["help"], ctx);
    for (const name of ["project show", "assets import", "assets set-import"])
      expect(help.stdout).toContain(name);
    const shown = await runCli(["project", "show", "--project", "platformer", "--json"], ctx);
    expect(shown.exitCode, shown.stdout).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({ project: "platformer" });
    const bad = await runCli(["assets", "nope"], ctx);
    expect(bad.exitCode).toBe(2);
    expect((await runCli(["project", "show"], ctx)).exitCode).toBe(2);
  });

  it("takes grid's flags", async () => {
    const r = await runCli(
      ["grid", "test-yard", "--from", "0,0", "--to", "3,4", "--fov", "1,1:5", "--diagonals"],
      ctx,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("grid-invalid");
    expect((await runCli(["grid", "test-yard", "--from"], ctx)).exitCode).toBe(2);
  });

  it("prints JSON with --json and exits 2 on usage errors", async () => {
    const r = await runCli(["validate", "test-yard", "--json"], ctx);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, counts: { error: 0 } });

    expect((await runCli(["validate", "test-yard", "--bogus"], ctx)).exitCode).toBe(2);
    expect((await runCli(["frobnicate"], ctx)).exitCode).toBe(2);
    expect((await runCli([], ctx)).exitCode).toBe(2);
    expect((await runCli(["show", "test-yard", "--ref"], ctx)).exitCode).toBe(2);
    expect((await runCli(["help"], ctx)).stdout).toContain("apply <scene> --ops");
  });

  it("passes --game and --type through", async () => {
    const s = await runCli(["schema", "scene", "--game", "platformer", "--json"], ctx);
    expect(JSON.parse(s.stdout).$id).toBe("urn:jams-engine:scene:platformer:v3");
    const shown = await runCli(["show", "engine-yard", "--type=prop", "--json"], ctx);
    expect(refs(JSON.parse(shown.stdout))).toEqual(["avatar", "crate"]);
    const stepped = await runCli(
      ["step", "engine-yard", "--game", avatarGame.id, "--ticks", "5", "--json"],
      ctx,
    );
    expect(JSON.parse(stepped.stdout).game).toBe(avatarGame.id);
  });

  it("treats Object.prototype names as unknown", async () => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      expect((await runCli([name], ctx)).exitCode, name).toBe(2);
    }
    expect((await runCli(["schema", "constructor"], ctx)).exitCode).toBe(2);
    expect((await runCli(["schema", "toString", "--json"], ctx)).exitCode).toBe(2);
    expect((await runCli(["schema", "--game", "toString"], ctx)).exitCode).toBe(2);
    expect((await runCli(["shw"], ctx)).stderr).toContain('did you mean "show"');
  });

  it("returns a JSON failure when a command throws", async () => {
    const broken: ToolContext = {
      ...ctx,
      loadRapier: () => Promise.reject(new Error("no wasm here")),
    };
    const r = await runCli(["step", "test-yard", "--json"], broken);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, error: "no wasm here" });
  });

  it("accepts --flag=value and switches", async () => {
    const r = await runCli(["show", "test-yard", "--ref=ball", "--json"], ctx);
    expect(JSON.parse(r.stdout).entities).toHaveLength(1);
    expect((await runCli(["fmt", "test-yard", "--check"], ctx)).exitCode).toBe(0);
    expect((await runCli(["fmt", "test-yard", "--check=yes"], ctx)).exitCode).toBe(2);
  });
});
