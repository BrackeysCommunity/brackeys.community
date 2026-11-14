// @vitest-environment node
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { RigidBody } from "@dimforge/rapier2d";
import { DEFAULT_ZIP_TARGET, exportTargetNames } from "@jams/engine/export";
import { defineGame, parseSaveFile } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import {
  checksKind,
  dataTableKind,
  gameSettingsKind,
  inputScriptKind,
  materialKind,
} from "@jams/engine/project";
import {
  AGENT_SURFACE_KEYWORD,
  AGENT_SURFACE_VERSION,
  createRegistry,
  ISSUE_CODES,
  makeIssue,
  OP_NAMES,
  parsePrefab,
  parseSceneOrThrow,
  SCENE_FORMAT_VERSION,
  sceneHash,
  type OpBatch,
} from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { platformerGame } from "../../../src/games/platformer";
import { COMMAND_NAMES, runCli } from "../commands";
import type { ToolContext } from "../context";
import { apply } from "../tools/apply";
import { assetsInfo } from "../tools/assets-info";
import { check } from "../tools/check";
import { codes } from "../tools/codes";
import { diff } from "../tools/diff";
import { flow } from "../tools/flow";
import { fmt } from "../tools/fmt";
import { fuzz } from "../tools/fuzz";
import { gameLiveBuild } from "../tools/game-live";
import { grid } from "../tools/grid";
import { input } from "../tools/input";
import { list } from "../tools/list";
import { newScene } from "../tools/new";
import { playtest } from "../tools/playtest";
import { replay, replayText } from "../tools/replay";
import { projectSaveFixtures, save } from "../tools/save";
import { schema } from "../tools/schema";
import { MAX_ROWS, show } from "../tools/show";
import { step } from "../tools/step";
import { validate } from "../tools/validate";
import { CARD_SPEED, CARD_TABLE, cardGame } from "./card-game";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const ENGINE_YARD = repoFile("packages/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("packages/engine/scenes/engine-yard.checks.json");
/** The engine yard frozen at format v3, in px. */
const ENGINE_YARD_V3 = repoFile("packages/engine/scene/__tests__/fixtures/v3/engine-yard.json");
const ENGINE_SCENES = repoFile("packages/engine/scenes");
/** The nested-prefab fixtures as v3 (px) files, for the commands that migrate them. */
const PREFAB_FIXTURES = repoFile("packages/engine/scene/__tests__/fixtures/prefabs-v3");
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

/** m/s. */
const WALK = 3;

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
  // The copies at the current format, in metres, whatever version the repo's files are at.
  const migrated = await fmt({}, ctx);
  expect(migrated.exitCode, migrated.text).toBe(0);
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
        bounds: [-20, -5, 40, 12],
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
      aabb: { minX: -20, minY: 10.2, maxX: 14.9, maxY: 10.6 },
      top: [-20, 14.9, 10.2],
    });
    expect(data.entities).toContainEqual({
      ref: "~spawn:0",
      type: "spawn",
      bulk: true,
      at: [9.6, 10.2],
    });
    expect(all.text.split("\n")[0]).toMatch(/ bounds -20,-5,40,12 m \(100 px\/m\)/);
    expect(all.text).toMatch(
      /^~solid:0 {2}solid .* aabb -20,10.2..14.9,10.6 m top -20..14.9@10.2 m/m,
    );

    const lift = await show({ scene: "test-yard", ref: "elevator" }, ctx);
    expect((lift.data as Rows).entities).toEqual([
      expect.objectContaining({
        ref: "elevator",
        type: "mover",
        aabb: { minX: 12.6, minY: 9.94, maxX: 13.4, maxY: 10.06 },
        extra: expect.objectContaining({ path: expect.objectContaining({ speed: 1 }) }),
      }),
    ]);

    const movers = await show({ scene: "test-yard", type: "mover" }, ctx);
    expect(refs(movers.data)).toEqual(["pit-shuttle", "elevator", "diagonal"]);
    expect(refs((await show({ scene: "test-yard", near: "5,8,0.2" }, ctx)).data)).toContain(
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

    const at30 = await tallyCtx({ tickRate: 30, physics: "rapier" });
    const project = await show({ scene: "tally-yard" }, at30);
    expect(project.text.split("\n")[1]).toBe(
      "time turns 30Hz catch-up 1000ms; physics none, no wasm",
    );
    const stepped = await step({ scene: "tally-yard", ticks: "3" }, at30);
    expect(stepped.exitCode, stepped.text).toBe(0);
    expect(stepped.data).toMatchObject({ tickRate: 30, ticks: 3 });
    await rm(join(root, tallyGame.id), { recursive: true, force: true });
    const at60 = await step({ scene: "tally-yard", ticks: "3" }, await tallyCtx());
    expect(at60.data).toMatchObject({ tickRate: 60 });
    expect((at60.data as { configHash: string }).configHash).not.toBe(
      (stepped.data as { configHash: string }).configHash,
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
    expect(data.settings).toEqual({ gravity: [0, 12] });
    expect(data).toMatchObject({ pxPerMetre: 100 });
    expect(data.entities).toContainEqual(
      expect.objectContaining({
        ref: "lift",
        type: "follower",
        aabb: { minX: 16.4, minY: 8.92, maxX: 17.6, maxY: 9.08 },
      }),
    );
    expect(data.entities).toContainEqual({
      ref: "start",
      type: "marker",
      at: [3, 9.6],
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
    yard.groups = { shelf: { at: [10, 5] } };
    yard.entities.push(
      { id: "board", type: "solid", group: "shelf", shape: ["box", 0, 0, 1, 0.1] },
      { id: "pin", type: "marker", group: "shelf", at: [0.4, -0.2] },
    );
    await writeFile(join(avatarDir, "grouped.json"), JSON.stringify(yard));
    const data = (await show({ scene: "grouped", ref: "board" }, ctx)).data as Rows;
    expect(data.entities).toEqual([
      expect.objectContaining({
        shape: ["box", 0, 0, 1, 0.1],
        origin: [10, 5],
        aabb: { minX: 9, minY: 4.9, maxX: 11, maxY: 5.1 },
        top: [9, 11, 4.9],
      }),
    ]);
    const near = refs((await show({ scene: "grouped", near: "10.4,4.8,0.05" }, ctx)).data);
    expect(near).toEqual(["pin"]);
  });

  it("shows a nested instance's children as a/b/c with z, turns, params and exposed params", async () => {
    await cp(PREFAB_FIXTURES, join(avatarDir, "prefabs"), { recursive: true });
    const yard = JSON.parse(await engineYardText());
    yard.name = "rooms";
    yard.instances = [
      { id: "room-1", prefab: "room", at: [10, 4], z: 1 },
      { id: "red-1", prefab: "red-gate", at: [4, 4], flip: true, params: { speed: 1.2 } },
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
      at: [10, 4],
      z: 1,
      nested: ["gate-1", "gate-2", "door-1", "door-1/latch"],
    });
    expect(byRef("room-1")).not.toHaveProperty("transform");
    expect(byRef("room-1/door-1/latch/door")).toMatchObject({
      type: "follower",
      instance: "room-1",
      instancePath: ["room-1", "door-1", "latch"],
      z: 3,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 0.3 }) }),
    });
    expect(byRef("room-1/door-1/panel")).toMatchObject({
      instancePath: ["room-1", "door-1"],
      z: 3,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 0.5 }) }),
    });
    expect(byRef("room-1/gate-2/door")).toMatchObject({
      transform: { rot: 2, flip: true },
      z: 1,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 0.9 }) }),
    });
    expect(byRef("room-1/lamp")).not.toHaveProperty("instancePath");

    expect(byRef("red-1")).toMatchObject({
      prefab: "red-gate",
      transform: { rot: 0, flip: true },
      params: { speed: 1.2 },
      exposes: ["speed"],
    });
    expect(byRef("red-1")).not.toHaveProperty("extra");
    expect(byRef("red-1/door")).toMatchObject({
      transform: { rot: 0, flip: true },
      z: 1,
      extra: expect.objectContaining({ path: expect.objectContaining({ speed: 1.2 }) }),
    });

    const one = await show({ scene: "rooms", ref: "room-1/door-1/latch/door" }, ctx);
    expect(refs(one.data)).toEqual(["room-1/door-1/latch/door"]);
    expect(r.text).toContain("room-1  instance of room at 10,4 m z 1");
    expect(r.text).toContain("nests gate-1,gate-2,door-1,door-1/latch");
    expect(r.text).toMatch(/^red-1 {2}instance of red-gate at 4,4 m turn 0 flip .*exposes speed/m);
    expect(r.text).toMatch(/^room-1\/gate-2\/door .* turn 2 flip z 1/m);
  });

  it("summarises grid fields and lists behaviors and z, after paintCells and setZ", async () => {
    const dir = join(root, cardGame.id);
    await mkdir(dir);
    await writeFile(
      join(dir, "card-sink.json"),
      JSON.stringify({
        v: SCENE_FORMAT_VERSION,
        game: cardGame.id,
        name: "card-sink",
        bounds: [0, 0, 20, 10],
        settings: { grid: { cell: [0.32, 0.32], kind: "square" } },
        entities: [
          { id: "lamp", type: "lamp", at: [2, 9], behaviors: { "card-game/glow": {} } },
          {
            id: "spinner",
            type: "lamp",
            z: 1,
            at: [4, 9],
            behaviors: {
              "card-game/glow": { color: "#00ccff" },
              "card-game/flicker": { rate: 6 },
            },
          },
          {
            id: "floor",
            type: "tiles",
            layer: "decor",
            at: [0, 6.4],
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
      at: [0, 6.4],
      grids: { cells: { cells: 97, chunks: 3, bounds: { c0: -1, r0: 0, c1: 39, r1: 2 } } },
      extra: { layer: "decor" },
    });
    expect(before.row("spinner")).toEqual({
      ref: "spinner",
      type: "lamp",
      at: [4, 9],
      z: 1,
      behaviors: {
        "card-game/glow": { color: "#00ccff" },
        "card-game/flicker": { rate: 6 },
      },
    });
    expect(before.text).toContain("floor  tiles at 0,6.4 m cells 97 cells -1,0..39,2");
    expect(before.text).toContain(
      "spinner  lamp at 4,9 m z 1 behaviors card-game/glow,card-game/flicker",
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
    yard.solid = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ["box", i * 0.3, 10, 0.1, 0.1]);
    yard.bounds = [-20, -5, 100, 12];
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
  it("serves every schema it names, fragment, prefab, save and the project schemas included", async () => {
    const usage = await runCli(["schema", "nope"], ctx);
    expect(usage.exitCode).toBe(2);
    for (const which of ["scene", "ops", "script", "checks", "recording", "fragment", "prefab"])
      expect(usage.stderr).toContain(which);
    const ids: Record<string, string> = {
      project: "urn:jams-engine:project:v1",
      "asset-sidecar": "urn:jams-engine:asset-sidecar:v1",
      "project-ops": "urn:jams-engine:project-ops:v1",
      "project-snapshot": "urn:jams-engine:project-snapshot:v1",
      save: "urn:jams-engine:save:v1",
      material: `urn:jams-engine:material:v${materialKind.version}`,
      "game-settings": `urn:jams-engine:game-settings:v${gameSettingsKind.version}`,
      "data-table": `urn:jams-engine:data-table:v${dataTableKind.version}`,
      "input-script": `urn:jams-engine:input-script:v${inputScriptKind.version}`,
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
    const v = `v${SCENE_FORMAT_VERSION}`;
    expect((await schema({}, ctx)).data).toMatchObject({ $id: `urn:jams-engine:scene:${v}` });
    for (const which of ["prefab", "fragment"]) {
      expect((await schema({ which }, ctx)).data, which).toMatchObject({
        $id: `urn:jams-engine:${which}:${v}`,
      });
      expect((await schema({ which, game: "platformer" }, ctx)).data, which).toMatchObject({
        $id: `urn:jams-engine:${which}:platformer:${v}`,
      });
    }
    expect((await schema({ which: "ops" }, ctx)).data).toMatchObject({
      $id: `urn:jams-engine:ops:${v}`,
    });
    expect((await schema({ game: "platformer" }, ctx)).data).toMatchObject({
      $id: `urn:jams-engine:scene:platformer:${v}`,
    });
    expect((await schema({ which: "ops", game: "platformer" }, ctx)).data).toMatchObject({
      $id: `urn:jams-engine:ops:platformer:${v}`,
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
    expect(listed).toMatch(/^  migration-unresolved +error .*\n    hint: .*vp run scene fmt/m);
    expect(listed).toMatch(/^  keys: An action's 0\.x `keys` are deprecated/m);
    expect((await codes({}, ctx)).data).toMatchObject({ notes: { keys: expect.any(String) } });
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
        ops: ops({ ops: [{ op: "update", ref: "lift", set: { "path.speed": 1.2 } }] }),
      },
      withGit,
    );
    const r = await diff({ a: "engine-yard", git: "HEAD~1" }, withGit);
    expect(r.exitCode).toBe(0);
    expect((r.data as { changes: unknown[] }).changes).toEqual([
      { kind: "modified", ref: "lift", field: "path.speed", from: 0.8, to: 1.2 },
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
    expect(def).toMatchObject({
      game: "platformer",
      name: "fresh",
      v: SCENE_FORMAT_VERSION,
      bounds: [0, 0, 19.2, 10.8],
    });
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
    const def = parseSceneOrThrow(await readFile(join(engineDir, "blank.json"), "utf8"), ENGINE);
    expect(def).toEqual({
      $schema: expect.any(String),
      v: SCENE_FORMAT_VERSION,
      name: "blank",
      bounds: [0, 0, 19.2, 10.8],
    });
    expect(join(engineDir, def.$schema!)).toBe(repoFile("packages/engine/scene/scene.schema.json"));
    expect((await newScene({ name: "blank-2" }, ctx)).exitCode).toBe(1);
  });

  it("points a project's first scene at the game's scene schema beside the project file", async () => {
    const dir = join(root, cardGame.id);
    const project = await tempProject(dir, { game: cardGame, assets: ["scenes/**"] });
    const withCards: ToolContext = { ...ctx, projects: [...ctx.projects, project] };
    const r = await newScene({ name: "first", game: cardGame.id }, withCards);
    expect(r.exitCode, r.text).toBe(0);
    const text = await readFile(join(dir, "scenes", "first.json"), "utf8");
    expect(JSON.parse(text)).not.toHaveProperty("$schema");

    await rm(join(dir, "scenes"), { recursive: true });
    await writeFile(join(dir, "scene.schema.json"), "{}\n");
    const again = await newScene({ name: "first", game: cardGame.id }, withCards);
    expect(again.exitCode, again.text).toBe(0);
    const first = JSON.parse(await readFile(join(dir, "scenes", "first.json"), "utf8")) as {
      $schema?: string;
    };
    expect(first.$schema).toBe("../scene.schema.json");

    const second = await newScene({ name: "second", game: cardGame.id }, withCards);
    expect(second.exitCode, second.text).toBe(0);
    const copied = JSON.parse(await readFile(join(dir, "scenes", "second.json"), "utf8")) as {
      $schema?: string;
    };
    expect(copied.$schema).toBe("../scene.schema.json");
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
    ).toMatchObject({ name: "annex", v: SCENE_FORMAT_VERSION });
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
      (await yardText()).replace('["box", 7, 9.4, 0.8, 0.08]', '["box", 7, 9.4, 0.8]'),
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
    await writeFile(sunk, (await yardText()).replace("[9.6, 10.2]", "[9.6, 10.4]"));
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

  it("migrates a v2 prefab and a v2 scene to the current format, in metres", async () => {
    await mkdir(join(avatarDir, "prefabs"));
    const v3 = await readFile(join(PREFAB_FIXTURES, "gate.json"), "utf8");
    const v2 = v3.replace('"v": 3,', '"v": 2,');
    expect(JSON.parse(v2)).toMatchObject({ kind: "prefab", v: 2 });
    await writeFile(join(avatarDir, "prefabs", "gate.json"), v2);
    const yard = JSON.parse(await readFile(ENGINE_YARD_V3, "utf8"));
    await writeFile(
      join(avatarDir, "old-yard.json"),
      `${JSON.stringify({ ...yard, v: 2, name: "old-yard" }, null, 2)}\n`,
    );
    const to = `to v${SCENE_FORMAT_VERSION}`;

    const checked = await fmt({ scene: "gate", check: true }, ctx);
    expect(checked.exitCode).toBe(1);
    expect(checked.data).toMatchObject({ asset: "gate", kind: "prefab", migratedFrom: 2 });
    expect(checked.text).toContain(`from v2 ${to}`);

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
    expect(written.text).toContain(`gate (prefab): formatted (from v2 ${to})`);
    const prefab = JSON.parse(await readFile(join(avatarDir, "prefabs", "gate.json"), "utf8"));
    expect(prefab).toMatchObject({ kind: "prefab", v: SCENE_FORMAT_VERSION, id: "gate" });
    const lifted = parsePrefab(v3, ENGINE);
    expect(lifted.ok && prefab.entities).toEqual(lifted.ok && lifted.prefab.entities);
    expect(prefab.entities[0].shape).toEqual(["box", 0, 0, 0.1, 0.4]);
    const migrated = JSON.parse(await readFile(join(avatarDir, "old-yard.json"), "utf8"));
    expect(migrated).toMatchObject({ v: SCENE_FORMAT_VERSION, bounds: [0, 0, 20, 10] });
    const again = await fmt({ scene: "gate", check: true }, ctx);
    expect(again.exitCode, again.text).toBe(0);
    expect(again.data).not.toHaveProperty("migratedFrom");
  });

  it("moves a v3 scene to v4 in metres, through the project's prefabs, and says so", async () => {
    await mkdir(join(avatarDir, "prefabs"));
    await copyFile(join(PREFAB_FIXTURES, "gate.json"), join(avatarDir, "prefabs", "gate.json"));
    const yard = JSON.parse(await readFile(ENGINE_YARD_V3, "utf8"));
    yard.name = "px-yard";
    yard.instances = [
      { id: "gate-1", prefab: "gate", at: [400, 900], overrides: { "door.path.speed": 120 } },
    ];
    await writeFile(join(avatarDir, "px-yard.json"), `${JSON.stringify(yard, null, 2)}\n`);

    const checked = await fmt({ scene: "px-yard", check: true }, ctx);
    expect(checked.exitCode, checked.text).toBe(1);
    expect(checked.text).toBe(
      "px-yard: not canonical (from v3 to v4); run vp run scene fmt px-yard",
    );
    const all = await fmt({ check: true }, ctx);
    expect(all.text).toContain("px-yard (scene): not canonical (from v3 to v4)");

    const written = await fmt({ scene: "px-yard" }, ctx);
    expect(written.text).toBe("px-yard: formatted (from v3 to v4)");
    const v4 = JSON.parse(await readFile(join(avatarDir, "px-yard.json"), "utf8"));
    expect(v4).toMatchObject({ v: 4, bounds: [0, 0, 20, 10], settings: { gravity: [0, 12] } });
    expect(v4.instances).toEqual([
      { id: "gate-1", prefab: "gate", at: [4, 9], overrides: { "door.path.speed": 1.2 } },
    ]);
    const shown = await show({ scene: "px-yard", ref: "gate-1/door" }, ctx);
    expect(shown.text).toContain("gate-1/door  follower");
    expect((await fmt({ scene: "px-yard", check: true }, ctx)).exitCode).toBe(0);
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

describe("fmt of input scripts", () => {
  it("writes a v1 script as v2, its start point in metres", async () => {
    const v1 = {
      v: 1,
      scene: "engine-yard",
      at: [300, 150],
      steps: [{ hold: ["right"], for: 10 }],
    };
    await writeFile(join(avatarDir, "walk.script.json"), JSON.stringify(v1));
    const r = await fmt({ scene: "walk-script" }, ctx);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({ kind: "input-script", changed: true, migratedFrom: 1 });
    expect(r.text).toContain("walk-script: formatted (from v1 to v2)");
    const written = JSON.parse(await readFile(join(avatarDir, "walk.script.json"), "utf8"));
    expect(written).toMatchObject({ v: 2, at: [3, 1.5], steps: [{ hold: ["right"], for: 10 }] });
    expect((await fmt({ scene: "walk-script", check: true }, ctx)).exitCode).toBe(0);
  });
});

describe("apply", () => {
  it("--dry-run returns the diff and writes nothing, on both yards", async () => {
    const before = await yardText();
    await writeFile(
      join(root, "ops.json"),
      JSON.stringify({ ops: [{ op: "update", ref: "elevator", set: { "path.speed": 1.4 } }] }),
    );
    const r = await apply({ scene: "test-yard", ops: join(root, "ops.json"), dryRun: true }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({
      ok: true,
      written: false,
      diff: [{ kind: "modified", ref: "elevator", field: "path.speed", from: 1, to: 1.4 }],
    });
    expect(r.data).not.toHaveProperty("def");
    expect(await yardText()).toBe(before);

    const engineBefore = await engineYardText();
    stdin = JSON.stringify({
      ops: [{ op: "add", entity: { id: "pad", type: "sensor", shape: ["box", 5, 9.5, 0.2, 0.1] } }],
    });
    const added = await apply({ scene: "engine-yard", ops: "-", dryRun: true }, ctx);
    expect(added.exitCode).toBe(0);
    expect(added.data).toMatchObject({ ok: true, written: false, created: ["pad"] });
    expect(await engineYardText()).toBe(engineBefore);

    stdin = JSON.stringify({
      ops: [{ op: "add", entity: { id: "c", type: "cloud", shape: ["box", 5, 9.5, 0.2, 0.1] } }],
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
    expect(data.final.position.x).toBeGreaterThan(9.6);
    expect(data.events).toContainEqual(
      expect.objectContaining({ type: "landed", entityId: "~solid:0" }),
    );
    expect(r.text).toContain('final {"position":');
    expect(r.text.split("\n")[0]).toMatch(/; lengths in m, speeds in m\/s \(100 px\/m\)$/);
    expect(r.data).toMatchObject({ pxPerMetre: 100 });

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
    expect(data.final.x).toBeGreaterThan(8);
    expect(data.final.y).toBeCloseTo(9.4, 1);
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

  it("judges --command tick@seat against the project input map's seats over the game's", async () => {
    const seated = { scene: "tally-yard", ticks: "6", command: ['2@2:bump={"n":3}'] };
    const gameSeats = await step(seated, await tallyCtx());
    expect(gameSeats.exitCode, gameSeats.text).toBe(2);
    expect(gameSeats.text).toContain('--command 2@2:bump={"n":3}:');

    await rm(join(root, tallyGame.id), { recursive: true, force: true });
    await mkdir(join(root, tallyGame.id), { recursive: true });
    await writeFile(
      join(root, tallyGame.id, "input-map.json"),
      JSON.stringify({ kind: "input-map", v: 1, players: { max: 3, join: "auto" } }),
    );
    const mapped = await step(seated, await tallyCtx());
    expect(mapped.exitCode, mapped.text).toBe(0);
    expect(mapped.data).toMatchObject({ final: { count: 3, log: ["2:bump"] } });
    const past = await step({ ...seated, command: ["2@3:reset"] }, await tallyCtx());
    expect(past.exitCode, past.text).toBe(2);
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
      "actions: move, jump",
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

/** A physics-free turns game listing a `pick` for each of `count` cards not yet picked; it wins when all are. */
function pickGame(count: number, refuses = false) {
  return defineGame<{ picked: number[] }>({
    id: refuses ? "refusing-pick-game" : "pick-game",
    types: [],
    actions: [],
    time: { kind: "turns" },
    world: { physics: "none" },
    commands: {
      pick: { description: "Picks card i.", args: z.strictObject({ i: z.number() }) },
      ...(refuses ? { refuse: { description: "Spawns a type nobody registered." } } : {}),
    },
    createRuntime(ctx) {
      const picked: number[] = [];
      return {
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) if (c.name === "pick") picked.push((c.args as { i: number }).i);
          if (commands.some((c) => c.name === "refuse")) ctx.spawn({ type: "nope", at: [0, 0] });
        },
        snapshot: () => ({ picked: [...picked] }),
      };
    },
    play: {
      results: ["won"],
      outcome: ({ snapshot }) => (snapshot.picked.length >= count ? { result: "won" } : null),
      commands: ({ snapshot }) =>
        Array.from({ length: count }, (_, i) => i)
          .filter((i) => !snapshot.picked.includes(i))
          .map((i) => ({ name: "pick", args: { i } })),
    },
  });
}

/** `ctx` plus a project for `pickGame(count)` holding pick-yard. */
async function pickCtx(count: number, refuses = false): Promise<ToolContext> {
  const game = pickGame(count, refuses);
  const dir = join(root, `${game.id}-${count}`);
  await mkdir(dir, { recursive: true });
  const yard = {
    v: 4,
    name: "pick-yard",
    game: game.id,
    bounds: [0, 0, 10, 10],
    entities: [{ id: "start", type: "marker", at: [1, 1] }],
  };
  await writeFile(join(dir, "pick-yard.json"), JSON.stringify(yard, null, 2));
  return {
    ...ctx,
    projects: [...ctx.projects, await tempProject(dir, { game })],
    loadRapier: () => Promise.reject(new Error("a physics-free run loaded Rapier")),
  };
}

describe("UI-only actions in step", () => {
  const menuGame = defineGame({
    id: "menu-game",
    types: [],
    actions: [
      { action: "go", bindings: [{ device: "key", code: "KeyG" }], description: "Goes." },
      {
        action: "menu",
        bindings: [{ device: "key", code: "Escape" }],
        description: "Opens the menu.",
        ui: true,
      },
    ],
    world: { physics: "none" },
    createRuntime: () => ({ snapshot: () => null }),
  });

  async function menuCtx(): Promise<ToolContext> {
    const dir = join(root, menuGame.id);
    await mkdir(dir, { recursive: true });
    const yard = {
      v: 4,
      name: "menu-yard",
      game: menuGame.id,
      bounds: [0, 0, 10, 10],
      entities: [],
    };
    await writeFile(join(dir, "menu-yard.json"), JSON.stringify(yard, null, 2));
    return {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: menuGame })],
      loadRapier: () => Promise.reject(new Error("a physics-free run loaded Rapier")),
    };
  }

  it("refuses a UI-only action in --hold and --inputs, as a script does", async () => {
    const menus = await menuCtx();
    expect((await step({ scene: "menu-yard", ticks: "2", hold: "go" }, menus)).exitCode).toBe(0);
    const held = await step({ scene: "menu-yard", ticks: "2", hold: "menu" }, menus);
    expect(held.exitCode).toBe(2);
    expect(held.text).toContain('--hold: "menu" is a UI-only action');
    expect(held.text).toContain("binding-unknown");
    expect(held.text).toContain("UI actions don't reach the simulation; send a command");
    await writeFile(join(root, "menu-in.json"), JSON.stringify([[1, "menu", 1]]));
    const pressed = await step(
      { scene: "menu-yard", ticks: "2", inputs: join(root, "menu-in.json") },
      menus,
    );
    expect(pressed.exitCode).toBe(2);
    expect(pressed.text).toContain('--inputs: "menu" is a UI-only action');
  });
});

describe("legal commands", () => {
  it("step --legal prints the commands legal after the steps, and --json carries them", async () => {
    const picks = await pickCtx(3);
    const r = await step(
      { scene: "pick-yard", ticks: "2", command: ['1:pick={"i":1}'], legal: true },
      picks,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain('  legal (2):\n    pick {"i":0}\n    pick {"i":2}');
    expect(r.text.indexOf("  legal (2)")).toBeGreaterThan(r.text.indexOf("t1 command pick"));
    expect(r.data).toMatchObject({
      legal: [
        { name: "pick", args: { i: 0 } },
        { name: "pick", args: { i: 2 } },
      ],
    });
    expect((await step({ scene: "pick-yard", ticks: "2" }, picks)).text).not.toContain("legal");

    const cli = await runCli(["step", "pick-yard", "--ticks", "1", "--legal", "--json"], picks);
    expect(cli.exitCode, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout).legal).toHaveLength(3);

    const many = await step({ scene: "pick-yard", ticks: "1", legal: true }, await pickCtx(70));
    expect(many.text).toContain("  legal (64, truncated):");
    expect(many.data).toMatchObject({ legalTruncated: true });
    const none = await step({ scene: "tally-yard", ticks: "1", legal: true }, await tallyCtx());
    expect(none.text).toContain("  legal: the game lists no commands");
    const done = await step(
      { scene: "pick-yard", ticks: "2", command: ['0:pick={"i":0}'], legal: true },
      await pickCtx(1),
    );
    expect(done.text).toContain("  legal: none");
  });

  it("step --legal says a blocked run of a game that lists commands has none", async () => {
    const blocked = await step(
      { scene: "pick-yard", ticks: "4", command: ["2:refuse"], legal: true },
      await pickCtx(3, true),
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.text).toContain("after 2 ticks\n  legal: none (run blocked)");
    expect(blocked.text).not.toContain("lists no commands");
  });

  it("playtest and fuzz print legal counts for a game that lists its commands", async () => {
    const picks = await pickCtx(3);
    const script = join(root, "pick-one.json");
    await writeFile(script, JSON.stringify({ v: 1, steps: [{ command: "pick", args: { i: 2 } }] }));
    const played = await playtest({ scene: "pick-yard", script }, picks);
    expect(played.exitCode, played.text).toBe(0);
    expect(played.text).toContain("  legal 2 commands");
    expect(played.data).toMatchObject({ legal: [{ args: { i: 0 } }, { args: { i: 1 } }] });

    const fuzzed = await fuzz({ scene: "pick-yard", rollouts: "4", ticks: "20" }, picks);
    expect(fuzzed.exitCode, fuzzed.text).toBe(0);
    expect(fuzzed.text).toContain("  results: won 4");
    expect(fuzzed.text).toContain("  legal: 12 commands sent, 0 macros with none legal");
    expect(fuzzed.data).toMatchObject({ legal: { sent: 12, empty: 0 } });

    const tally = await fuzz({ scene: "tally-yard", rollouts: "1", ticks: "5" }, await tallyCtx());
    expect(tally.text).not.toContain("legal");
  });
});

describe("--timing", () => {
  type Bucket = { calls: number; totalMs: number; maxMs: number };
  type Timing = {
    tick: Bucket & { unattributedMs: number; parts: Record<string, Bucket> };
    groups: Record<"physics" | "engine" | "game" | "unattributed", number>;
  };

  it("step --timing adds the tick's parts to the stats and the text, and nothing else", async () => {
    const plain = await step({ scene: "engine-yard", ticks: "40" }, ctx);
    const timed = await step({ scene: "engine-yard", ticks: "40", timing: true }, ctx);
    expect(timed.exitCode, timed.text).toBe(0);
    expect(plain.text).not.toContain("timing");
    expect("timing" in (plain.data as { stats: object }).stats).toBe(false);

    const data = timed.data as { stats: { timing: Timing } };
    const { timing, ...stats } = data.stats;
    expect({ ...data, stats }).toEqual(plain.data);
    expect(timed.text.startsWith(`${plain.text}\n  timing (wall clock): 40 ticks in `)).toBe(true);

    const { tick, groups } = timing;
    expect(tick.calls).toBe(40);
    expect(tick.parts["physics.step"]).toMatchObject({ calls: 40 });
    expect(Object.keys(tick.parts)).toContain("system.follower.beforeStep");
    const covered = Object.values(tick.parts).reduce((sum, part) => sum + part.totalMs, 0);
    expect(covered).toBeLessThanOrEqual(tick.totalMs + 0.01);
    expect(groups.physics).toBe(tick.parts["physics.step"]!.totalMs);
    expect(groups.game).toBe(0);
    expect(groups.physics + groups.engine + groups.unattributed).toBeCloseTo(tick.totalMs, 1);
    for (const line of ["    physics.step ", "    unattributed ", "    by group: physics "])
      expect(timed.text).toContain(line);

    const cli = await runCli(["step", "engine-yard", "--ticks", "5", "--timing", "--json"], ctx);
    expect(cli.exitCode, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout).stats.timing.tick.calls).toBe(5);
  });

  it("times the game's hooks as the game's", async () => {
    const timed = await step(
      { scene: "engine-yard", ticks: "10", game: avatarGame.id, timing: true },
      ctx,
    );
    const { tick, groups } = (timed.data as { stats: { timing: Timing } }).stats.timing;
    expect(tick.parts["game.snapshot"]).toMatchObject({ calls: 10 });
    expect(groups.game).toBeGreaterThan(0);
  });

  it("playtest --timing reports beside the run, whose recording is the untimed one's", async () => {
    const plain = await playtest({ scene: "test-yard", script: HOP_LEFT }, ctx);
    const timed = await playtest({ scene: "test-yard", script: HOP_LEFT, timing: true }, ctx);
    expect(timed.exitCode, timed.text).toBe(0);
    const { timing, ...run } = timed.data as { timing: Timing; ticks: number };
    expect(run).toEqual(plain.data);
    expect(timing.tick.calls).toBe(run.ticks);
    expect(timing.groups.game).toBeGreaterThan(0);
    expect(timed.text.startsWith(`${plain.text}\n  timing (wall clock): ${run.ticks} ticks`)).toBe(
      true,
    );
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
/** Recordings frozen at format v1, with the scenes they were made on. */
const V1_RECORDINGS = repoFile("packages/engine/headless/__tests__/fixtures/recordings/v1");

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

    const from = await playtest({ scene: "test-yard", script: HOP_LEFT, at: "3,6" }, ctx);
    expect((from.data as Played).final.position.x).toBeLessThan(3);
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

    const inside = await playtest({ scene: "test-yard", script: HOP_LEFT, at: "12,7" }, ctx);
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

  it("replays a frozen v1 recording, saying it migrated, where and on what it was made", async () => {
    const r = await replay(
      {
        scene: join(V1_RECORDINGS, "scenes", "test-yard.json"),
        run: join(V1_RECORDINGS, "platformer.hop-left.recording.json"),
      },
      ctx,
    );
    expect(r.data).toMatchObject({
      game: "platformer",
      migratedFrom: 1,
      issues: [],
      recorded: {
        engine: { version: "0.10.0" },
        platform: { arch: "unknown", runtime: "unknown", flavour: null },
      },
    });
    expect(r.text).toContain("recorded on engine 0.10.0, physics rapier");
    expect(r.text).toContain("; migratedFrom 1");
    expect(r.text).toMatch(/^  platform recorded unknown; replayed \S+, (node|bun) /m);
  });

  it("prints recording-other-platform from the replay's issues", async () => {
    const file = join(root, "hop3.rec.json");
    await playtest({ scene: "test-yard", script: HOP_LEFT, record: file }, ctx);
    const rec = JSON.parse(await readFile(file, "utf8")) as {
      v: number;
      engine: { version: string; physics: string | null };
      platform: { arch: string; runtime: string; flavour: string | null };
    };
    expect(rec.v).toBe(2);
    expect(rec.platform.flavour).toBeNull();
    const r = await replay({ scene: "test-yard", run: file }, ctx);
    expect(r.text).toContain(`platform recorded ${rec.platform.arch}, ${rec.platform.runtime}`);
    expect(r.data).not.toHaveProperty("migratedFrom");
    const report = r.data as Parameters<typeof replayText>[1];
    const other = makeIssue("recording-other-platform", {
      message: "recorded on x64 with rapier, replayed on arm64",
    });
    const text = replayText("test-yard", { ...report, issues: [other] }, rec);
    expect(text).toContain("  warn recording-other-platform recorded on x64 with rapier");
    expect(text).toContain(`hint: ${ISSUE_CODES["recording-other-platform"].hint}`);
  });

  it("names the context's Rapier package as the recording's flavour", async () => {
    const file = join(root, "hop4.rec.json");
    const named = { ...ctx, rapierFlavour: "rapier2d" };
    await playtest({ scene: "test-yard", script: HOP_LEFT, record: file }, named);
    const rec = JSON.parse(await readFile(file, "utf8")) as { platform: { flavour: string } };
    expect(rec.platform.flavour).toBe("rapier2d");
    const r = await replay({ scene: "test-yard", run: file }, named);
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/platform recorded .*, rapier2d; replayed .*, rapier2d$/m);
  });

  it("replays a run's swaps from --versions, and stops at one it doesn't have", async () => {
    const file = join(root, "hop5.rec.json");
    await playtest({ scene: "test-yard", script: HOP_LEFT, record: file }, ctx);
    const versions = join(root, "versions");
    const built = await gameLiveBuild(
      { project: "platformer", scene: "test-yard", hosted: false, out: join(versions, "a") },
      ctx,
    );
    expect(built.exitCode, built.text).toBe(0);
    const { id } = built.data as { id: string };
    const rec = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const swap = { tick: 30, version: id, strategy: "reconcile", timing: "now" };
    await writeFile(
      join(root, "swapped.json"),
      JSON.stringify({ ...rec, swaps: [{ ...swap, sceneHash: "0", runHash: "0" }] }),
    );
    const first = await replay(
      { scene: "test-yard", run: join(root, "swapped.json"), versions },
      ctx,
    );
    const replayed = (first.data as { recording: { swaps?: unknown[] } }).recording;
    expect(replayed.swaps).toEqual([expect.objectContaining(swap)]);

    await writeFile(join(root, "replayed.json"), JSON.stringify(replayed));
    const again = await replay(
      { scene: "test-yard", run: join(root, "replayed.json"), versions },
      ctx,
    );
    expect(again.exitCode, again.text).toBe(0);
    expect(again.data).toMatchObject({ matches: true, stale: false, versions: { ids: [id] } });
    expect(again.text).toContain(`  swap t30 to test-yard@${id.slice(0, 12)} (reconcile, now)`);

    const without = await replay({ scene: "test-yard", run: join(root, "replayed.json") }, ctx);
    expect(without.exitCode).toBe(1);
    expect(without.text).toContain("scene-version-removed");
    expect(
      (await replay({ scene: "test-yard", run: file, versions: join(root, "nowhere") }, ctx))
        .exitCode,
    ).toBe(1);
  });
});

describe("input", () => {
  /** Two seats: a 0.x `keys` action, buttons by code and pad, an axis and a stick. */
  const seatsGame = defineGame({
    id: "seats-game",
    types: [],
    actions: [
      { action: "left", keys: ["a"], description: "Walk left." },
      {
        action: "jump",
        bindings: [
          { device: "key", code: "Space" },
          { device: "pad", button: "south" },
        ],
        description: "Jump.",
      },
      {
        action: "steer",
        kind: "axis",
        bindings: [
          { device: "key", code: "ArrowLeft", value: -1 },
          { device: "key", code: "ArrowRight", value: 1 },
        ],
        description: "Steer.",
      },
      {
        action: "aim",
        kind: "vector",
        bindings: [{ device: "pad", stick: "left" }],
        description: "Aim.",
      },
    ],
    input: { players: { max: 2, join: "press" } },
    createRuntime: () => ({ snapshot: () => null }),
  });

  type Row = {
    action: string;
    kind: string;
    source: string | null;
    layers: { map?: { binding: unknown; problems: unknown[] }[]; game?: { binding: unknown }[] };
    keys?: string[];
    mapRefused?: boolean;
  };
  type Report = {
    project: string;
    game: string | null;
    players: { max: number; join: string };
    inputMap: { id: string } | null;
    issues: { code: string; path: string; message: string }[];
    seats: { player: number; actions: Row[] }[];
  };

  async function seatsCtx(map: unknown): Promise<ToolContext> {
    const dir = join(root, seatsGame.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "input.json"), JSON.stringify(map));
    return {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: seatsGame })],
      project: seatsGame.id,
      loadRapier: () => Promise.reject(new Error("input loads no Rapier")),
    };
  }
  const report = (data: unknown) => (data as { projects: Report[] }).projects[0]!;
  const row = (r: Report, player: number, action: string) =>
    r.seats.find((s) => s.player === player)!.actions.find((a) => a.action === action)!;

  it("prints each seat's bindings layer by layer, the map over the game", async () => {
    const seats = await seatsCtx({
      kind: "input-map",
      v: 1,
      actions: [
        {
          action: "jump",
          bindings: [
            { device: "key", code: "KeyW" },
            { device: "key", code: "KeyI", player: 1 },
          ],
        },
      ],
    });
    const r = await input({}, seats);
    expect(r.exitCode, r.text).toBe(0);
    const data = report(r.data);
    expect(data).toMatchObject({
      project: seatsGame.id,
      game: seatsGame.id,
      players: { max: 2, join: "press" },
      inputMap: { id: "input" },
      issues: [],
    });
    expect(data.seats.map((s) => s.player)).toEqual([0, 1]);
    expect(row(data, 0, "jump")).toMatchObject({
      kind: "button",
      source: "map",
      layers: {
        map: [{ binding: { device: "key", code: "KeyW" }, problems: [] }],
        game: [
          { binding: { device: "key", code: "Space" } },
          { binding: { device: "pad", button: "south" } },
        ],
      },
    });
    expect(row(data, 1, "jump").layers.map).toEqual([
      { binding: { device: "key", code: "KeyW" }, problems: [] },
      { binding: { device: "key", code: "KeyI", player: 1 }, problems: [] },
    ]);
    expect(row(data, 0, "left")).toMatchObject({
      source: "game",
      keys: ["a"],
      layers: { game: [{ binding: { device: "key", code: "KeyA" } }] },
    });
    expect(row(data, 0, "steer")).toMatchObject({ kind: "axis", source: "game" });
    expect(row(data, 0, "aim")).toMatchObject({
      kind: "vector",
      layers: { game: [{ binding: { device: "pad", stick: "left" } }] },
    });

    expect(r.text).toContain(
      `${seatsGame.id} (game ${seatsGame.id}): 2 seats, join press; input map input`,
    );
    expect(r.text).toMatch(
      /^    jump \(button\) from map\n     \*map   key KeyW\n      game  key Space, pad button south$/m,
    );
    expect(r.text).toMatch(/^     \*game  key KeyA \[from 0\.x keys \["a"\], deprecated\]$/m);
    expect(r.text).toContain("key ArrowLeft (value -1), key ArrowRight (value 1)");
    expect(r.text).toContain("remaps live in the player's browser; input maps are project docs");

    const one = await runCli(
      ["input", "--project", seatsGame.id, "--player", "1", "--json"],
      seats,
    );
    expect(one.exitCode, one.stderr).toBe(0);
    const only = report(JSON.parse(one.stdout));
    expect(only.seats.map((s) => s.player)).toEqual([1]);
  });

  it("reports the map's binding issues, keeping the game's bindings for a refused action", async () => {
    const seats = await seatsCtx({
      kind: "input-map",
      v: 1,
      actions: [{ action: "steer", bindings: [{ device: "key", code: "KeyQQ", value: -1 }] }],
    });
    const r = await input({}, seats);
    expect(r.exitCode).toBe(1);
    const data = report(r.data);
    expect(data.issues).toContainEqual(
      expect.objectContaining({ code: "binding-unknown", path: "/actions/0/bindings/0/code" }),
    );
    expect(row(data, 0, "steer")).toMatchObject({ source: "game", mapRefused: true });
    expect(r.text).toContain("error binding-unknown");
    expect(r.text).toContain('did you mean "KeyQ"');
    expect(r.text).toContain("map   refused (see the map's issues); the game's apply");
  });

  it("refuses a seat past the last with player-unknown, and a bad --player", async () => {
    const seats = await seatsCtx({ kind: "input-map", v: 1 });
    const past = await input({ player: "2" }, seats);
    expect(past.exitCode).toBe(1);
    expect(past.data).toMatchObject({ ok: false, problems: [{ code: "player-unknown" }] });
    expect(past.text).toContain("player-unknown");
    expect((await input({ player: "x" }, seats)).exitCode).toBe(2);
    expect((await input({}, { ...seats, project: "nope" })).exitCode).toBe(2);
  });

  it("shows a project without an input map", async () => {
    const r = await input({}, { ...ctx, project: avatarGame.id });
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain(
      `${avatarGame.id} (game ${avatarGame.id}): 1 seat, join auto; no input map`,
    );
    expect(report(r.data).inputMap).toBeNull();
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
    expect(engine.data).toMatchObject({ $id: "urn:jams-engine:input-script:v2" });
    const game = await runCli(["schema", "script", "--game", "platformer", "--json"], ctx);
    const parsed = JSON.parse(game.stdout) as {
      $id: string;
      $defs: { Action: { enum: string[] } };
    };
    expect(parsed.$id).toBe("urn:jams-engine:input-script:platformer:v2");
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

/** Spawns a marker every tick and destroys the oldest once three are live; `refuse` spawns an unknown type. */
const spawnerGame = defineGame({
  id: "spawner-game",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Unused." }],
  commands: { refuse: { description: "Spawns a type nobody registered." } },
  createRuntime(ctx) {
    const live: string[] = [];
    return {
      beforeStep(_dt, _actions, commands) {
        if (commands.some((c) => c.name === "refuse")) ctx.spawn({ type: "nope", at: [0, 0] });
        if (live.length >= 3) ctx.destroy(live.shift()!);
        live.push(ctx.spawn({ type: "marker", at: [16, 16] }).id);
      },
      snapshot: () => ({ live: live.length }),
    };
  },
});

/** Places the project's `beacon` prefab on a `place` command; the run is `lit` once the beacon is live. */
const placerGame = defineGame({
  id: "placer-game",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Unused." }],
  commands: { place: { description: "Instantiates the beacon prefab." } },
  play: {
    results: ["lit"],
    outcome: ({ world }) =>
      world?.exists("beacon#1") ? { result: "lit", entityId: "beacon#1" } : null,
  },
  createRuntime(ctx) {
    const placed: string[] = [];
    return {
      beforeStep(_dt, _actions, commands) {
        if (commands.some((c) => c.name === "place"))
          placed.push(ctx.instantiate("beacon", [1, 1]).id);
      },
      snapshot: () => ({ placed: [...placed] }),
    };
  },
});

describe("lifecycle events", () => {
  type Reported = {
    events: { type: string; entityId?: string; data?: unknown }[];
    lifecycle?: Record<string, { spawned: number; destroyed: number }>;
    stage?: string;
    issues?: { code: string }[];
  };

  async function spawnerCtx(): Promise<ToolContext> {
    const dir = join(root, spawnerGame.id);
    await mkdir(dir);
    await writeFile(
      join(dir, "spawn-yard.json"),
      JSON.stringify({
        v: 1,
        name: "spawn-yard",
        game: spawnerGame.id,
        bounds: [0, 0, 320, 240],
        settings: { physics: "none" },
        entities: [{ id: "start", type: "marker", at: [16, 16] }],
      }),
    );
    return {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: spawnerGame })],
      loadRapier: () => Promise.reject(new Error("a physics-free run loaded Rapier")),
    };
  }

  it("step summarises spawns and destroys per type and --events filters the printed events", async () => {
    const spawner = await spawnerCtx();
    const r = await step({ scene: "spawn-yard", ticks: "20" }, spawner);
    expect(r.exitCode, r.text).toBe(0);
    const data = r.data as Reported;
    expect(data.lifecycle).toEqual({ marker: { spawned: 20, destroyed: 17 } });
    expect(r.text).toContain("  spawned marker ×20, destroyed ×17");
    expect(data.events).toContainEqual(
      expect.objectContaining({ type: "entity:spawned", entityId: "marker#1" }),
    );
    expect(r.text).toContain("entity:destroyed marker#1");

    const only = await step(
      { scene: "spawn-yard", ticks: "20", events: "entity:destroyed" },
      spawner,
    );
    const filtered = only.data as Reported;
    expect(filtered.events).toHaveLength(17);
    expect(filtered.events.every((e) => e.type === "entity:destroyed")).toBe(true);
    expect(filtered.lifecycle).toEqual(data.lifecycle);
    expect(only.text).toContain("spawned marker ×20, destroyed ×17");
    expect(only.text).not.toContain("entity:spawned");

    const cli = await runCli(
      ["step", "spawn-yard", "--ticks", "20", "--events", "entity:destroyed", "--json"],
      spawner,
    );
    expect(cli.exitCode, cli.stderr).toBe(0);
    expect((JSON.parse(cli.stdout) as Reported).events).toEqual(filtered.events);

    expect((await step({ scene: "spawn-yard", events: " , " }, spawner)).exitCode).toBe(2);
    const quiet = await step({ scene: "engine-yard", ticks: "10" }, ctx);
    expect(quiet.data).not.toHaveProperty("lifecycle");
  });

  it("playtest summarises spawns, filters events and waits on exists and count", async () => {
    const spawner = await spawnerCtx();
    await writeFile(
      join(root, "spawns.json"),
      JSON.stringify({
        v: 1,
        steps: [
          { hold: [], until: { exists: "marker#5" }, max: 100 },
          { hold: [], until: { count: { type: "marker", min: 4 } }, max: 100 },
          { wait: 10 },
        ],
      }),
    );
    const r = await playtest({ scene: "spawn-yard", script: join(root, "spawns.json") }, spawner);
    expect(r.exitCode, r.text).toBe(0);
    const data = r.data as Reported & { steps: { end: string }[] };
    expect(data.steps.map((s) => s.end)).toEqual(["until", "until", "done"]);
    const spawned = data.lifecycle?.marker?.spawned ?? 0;
    expect(spawned).toBeGreaterThan(5);
    expect(data.lifecycle?.marker?.destroyed).toBe(spawned - 3);
    expect(r.text).toContain(`spawned marker ×${spawned}, destroyed ×${spawned - 3}`);

    const only = await playtest(
      { scene: "spawn-yard", script: join(root, "spawns.json"), events: "entity:spawned" },
      spawner,
    );
    const kept = (only.data as Reported).events;
    expect(kept).toHaveLength(spawned);
    const cli = await runCli(
      [
        "playtest",
        "spawn-yard",
        "--script",
        join(root, "spawns.json"),
        "--events",
        "entity:spawned",
        "--json",
      ],
      spawner,
    );
    expect(cli.exitCode, cli.stderr).toBe(0);
    expect((JSON.parse(cli.stdout) as Reported).events).toEqual(kept);
    expect(kept.every((e) => e.type === "entity:spawned")).toBe(true);
    expect(
      (
        await playtest(
          { scene: "spawn-yard", script: join(root, "spawns.json"), events: "" },
          spawner,
        )
      ).exitCode,
    ).toBe(2);
  });

  it("blocks a step at stage run on a runtime refusal, with its code and the ticks before it", async () => {
    const spawner = await spawnerCtx();
    const r = await step({ scene: "spawn-yard", ticks: "10", command: "4:refuse" }, spawner);
    expect(r.exitCode).toBe(1);
    const data = r.data as Reported & { ok: boolean; blocked: boolean; ticks: number };
    expect(data).toMatchObject({ ok: false, blocked: true, stage: "run", ticks: 4 });
    expect(data.issues?.map((i) => i.code)).toContain("unknown-type");
    expect(data.lifecycle).toEqual({ marker: { spawned: 4, destroyed: 1 } });
    expect(r.text).toContain("spawn-yard: blocked at run");
    expect(r.text).toContain("unknown-type");
    expect(r.text).toContain("after 4 ticks");
    expect(r.text).not.toMatch(/^error:/m);

    const cli = await runCli(["step", "spawn-yard", "--command", "4:refuse", "--json"], spawner);
    expect(cli.exitCode).toBe(1);
    expect(JSON.parse(cli.stdout)).toMatchObject({ blocked: true, stage: "run" });
  });

  it("step places a project prefab no scene uses from a --command, and the outcome sees it", async () => {
    const dir = join(root, placerGame.id);
    await mkdir(join(dir, "prefabs"), { recursive: true });
    await writeFile(
      join(dir, "place-yard.json"),
      JSON.stringify({
        v: SCENE_FORMAT_VERSION,
        name: "place-yard",
        game: placerGame.id,
        bounds: [0, 0, 3.2, 2.4],
        settings: { physics: "none" },
        entities: [{ id: "start", type: "marker", at: [0.16, 0.16] }],
      }),
    );
    await writeFile(
      join(dir, "prefabs", "beacon.json"),
      JSON.stringify({
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "beacon",
        entities: [{ id: "light", type: "marker", at: [0, 0] }],
      }),
    );
    const placer = {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: placerGame })],
    };
    const r = await step({ scene: "place-yard", ticks: "6", command: "2:place" }, placer);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({
      outcome: { result: "lit", tick: 2, entityId: "beacon#1" },
      final: { placed: ["beacon#1"] },
    });
    expect(r.text).toContain("  outcome t2 lit");
    const idle = await step({ scene: "place-yard", ticks: "6" }, placer);
    expect(idle.data).not.toHaveProperty("outcome");
  });

  it("blocks a playtest at stage run on a runtime refusal, with its code", async () => {
    const spawner = await spawnerCtx();
    await writeFile(
      join(root, "refuse.json"),
      JSON.stringify({ v: 1, steps: [{ wait: 5 }, { command: "refuse" }, { wait: 5 }] }),
    );
    const r = await playtest({ scene: "spawn-yard", script: join(root, "refuse.json") }, spawner);
    expect(r.exitCode).toBe(1);
    const data = r.data as Reported;
    expect(data.stage).toBe("run");
    expect(data.issues?.map((i) => i.code)).toContain("unknown-type");
    expect(r.text).toContain("blocked at run");
    expect(r.text).toContain("unknown-type");
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
    v: SCENE_FORMAT_VERSION,
    name: "grid-yard",
    bounds: [0, 0, 1.92, 0.96],
    settings: { physics: "none", grid: settings },
    solid: [["box", 0.8, 0.16 * wallRows, 0.16, 0.16 * wallRows]],
    entities: [
      { id: "start", type: "marker", at: [0.16, 0.16] },
      { id: "exit", type: "marker", at: [1.76, 0.16] },
    ],
  });
  const SQUARE = { kind: "square", cell: [0.32, 0.32] };
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
        "grid-yard grid square 0.32×0.32 m: cells [0, 0]..[5, 2] (6×3), 2 walls",
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
    const hex = { kind: "hex", cell: [0.32, 0.32], side: 0.16, stagger: "y", index: "odd" };
    const file = await write(yard(2, hex));
    const r = await grid(
      { scene: file, from: "start", to: "exit", fov: "start:2", diagonals: false },
      noRapier(),
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toBe(
      [
        "grid-yard grid hex 0.32×0.32 m side 0.16 m, stagger y odd: cells [-1, -1]..[5, 3] (7×5), 4 walls",
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
      $id: `urn:jams-engine:checks:v${checksKind.version}`,
      [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    });
    const game = await runCli(["schema", "checks", "--game", "platformer", "--json"], ctx);
    expect((JSON.parse(game.stdout) as { $id: string }).$id).toBe(
      `urn:jams-engine:checks:platformer:v${checksKind.version}`,
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
      "flow",
      "input",
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
      "save",
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
      "game new",
      "game build",
      "game export",
      "game manifest",
      "game release create",
      "game release list",
      "game release promote",
      "game release rollback",
      "game live build",
      "game live check",
      "game live publish",
      "game live list",
      "game live promote",
      "game live rollback",
      "game live clear",
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

  it("shows game new's flags and step's --legal in the help", async () => {
    const help = (await runCli(["help"], ctx)).stdout;
    expect(help).toContain(
      'game new <id> [--name "Title"] [--preset top-down|side-view|grid|turns] [--physics none|rapier] [--gravity x,y] [--time fixed|turns|event] [--rate n] [--grid square|hex|none] [--cell n] [--px-per-metre n] [--dir src/games] [--dry-run]',
    );
    expect(help).toMatch(/step <scene\|file\|-> .*\[--legal\] \[--timing\]\n/);
    expect(help).toMatch(/playtest <scene\|file\|-> .*\[--timing\] \[--present\]\n/);
    const bare = await runCli(["game", "new"], ctx);
    expect(bare.exitCode).toBe(2);
    expect(bare.stderr).toContain("game new <id> [--name");
  });

  it("shows flow, save, and playtest's and fuzz's flow and save flags in the help", async () => {
    const help = (await runCli(["help"], ctx)).stdout;
    expect(help).toContain("flow [--project p] [--json]");
    expect(help).toContain(
      "save <scene|file> --script <file|-> --at <tick> --out <file>.save.json [--depth world|progress]",
    );
    expect(help).toMatch(/playtest <scene\|file\|-> .*\[--flow\] \[--from-save file\]/);
    expect(help).toMatch(/fuzz <scene\|file\|-> .*\[--from-save file\]/);
  });

  it("shows game build, export and manifest, and replay --releases, in the help", async () => {
    const help = (await runCli(["help"], ctx)).stdout;
    const targets = exportTargetNames();
    const zipTargets = [DEFAULT_ZIP_TARGET, ...targets.filter((t) => t !== DEFAULT_ZIP_TARGET)];
    expect(help).toContain(
      `game build <id> [--target ${targets.join("|")}] [--out dist/games/<id>/<target>] [--rapier standard|compat] [--allow-over-budget]`,
    );
    expect(help).toContain(
      `game export <id> --zip [--target ${zipTargets.join("|")}] [--out dist/games/<id>-<target>.zip]`,
    );
    expect(help).toContain("game manifest <dir|release.json>");
    expect(help).toContain(
      "replay <scene|file|-> --run <file|-> [--game id] [--releases <dir>] [--versions <dir>]",
    );
    const bare = await runCli(["game", "build"], ctx);
    expect(bare.exitCode).toBe(2);
    expect(bare.stderr).toContain("game build <id>");
    const unzipped = await runCli(["game", "export", "tactics"], ctx);
    expect(unzipped.exitCode).toBe(2);
    expect(unzipped.stderr).toContain("game export <id> --zip");
    const noPath = await runCli(["game", "manifest"], ctx);
    expect(noPath.exitCode).toBe(2);
    expect(noPath.stderr).toContain("game manifest <dir|release.json>");
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
    expect(JSON.parse(s.stdout).$id).toBe(
      `urn:jams-engine:scene:platformer:v${SCENE_FORMAT_VERSION}`,
    );
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

type Dice = { steps: number; total: number; rolls: number };

/**
 * A physics-free game whose state a world save holds: a die rolled each
 * tick `roll` is held, on `ctx.random`. Holding `door` asks flow for the
 * other table.
 */
const diceGame = defineGame<Dice>({
  id: "dice",
  types: [],
  actions: [
    { action: "roll", keys: ["r"], description: "Rolls a die each tick while held." },
    { action: "door", keys: ["e"], description: "Asks for the other table." },
  ],
  world: { physics: "none" },
  createRuntime(ctx) {
    let state: Dice = { steps: 0, total: 0, rolls: 0 };
    return {
      onLoad() {
        state = { steps: 0, total: 0, rolls: 0 };
      },
      beforeStep() {
        state.steps++;
        if (ctx.input.held("door"))
          ctx.flow.request({ to: ctx.flow.scene === "table-2" ? "table" : "table-2" });
        if (!ctx.input.held("roll")) return;
        state.total += ctx.random.below(6) + 1;
        state.rolls++;
      },
      snapshot: () => ({ ...state }),
      // In snapshot order: a save's text holds its keys sorted, and the end digest reads the order.
      restore(saved) {
        state = { steps: saved.steps, total: saved.total, rolls: saved.rolls };
      },
    };
  },
});

const diceTable = (name: string) =>
  JSON.stringify({
    v: SCENE_FORMAT_VERSION,
    name,
    game: diceGame.id,
    bounds: [0, 0, 4, 4],
    settings: { physics: "none" },
    entities: [{ id: "spot", type: "marker", at: [1, 1] }],
  });

const rolls = (ticks: number) =>
  JSON.stringify({ v: 1, seed: 7, steps: [{ hold: ["roll"], for: ticks }] });

async function diceCtx(): Promise<{
  dir: string;
  dice: ToolContext;
  script: (n: number) => Promise<string>;
}> {
  const dir = join(root, diceGame.id);
  await mkdir(join(dir, "scenes"), { recursive: true });
  await writeFile(join(dir, "scenes", "table.json"), diceTable("table"));
  await writeFile(join(dir, "scenes", "table-2.json"), diceTable("table-2"));
  await writeFile(
    join(dir, "scene-list.json"),
    JSON.stringify({
      kind: "scene-list",
      v: 1,
      start: "table",
      scenes: [{ scene: "table" }, { scene: "table-2" }],
    }),
  );
  const dice = { ...ctx, projects: [...ctx.projects, await tempProject(dir, { game: diceGame })] };
  const script = async (n: number) => {
    const file = join(root, `rolls-${n}.json`);
    await writeFile(file, rolls(n));
    return file;
  };
  return { dir, dice, script };
}

type Saved = { ok: boolean; slot: string; depth: string; sha256: string; project: string | null };
type Run = {
  final: Dice;
  ticks: number;
  outcome: { result: string; to?: string };
  recording: { end: string; fromSave?: { slot: string; sha256: string } };
  segments?: { scene: string; ticks: number; end: { result: string; to?: string } }[];
  fromSave?: { sha256: string };
};

describe("save fixtures", { timeout: 60_000 }, () => {
  it("scene save then playtest --from-save reproduces the uninterrupted run's end", async () => {
    const { dir, dice, script } = await diceCtx();
    const whole = await script(60);
    const out = join(dir, "saves", "mid.save.json");

    const saved = await save({ scene: "table", script: whole, at: "30", out, now: 0 }, dice);
    expect(saved.exitCode, saved.text).toBe(0);
    expect(saved.data).toMatchObject({ ok: true, slot: "mid", depth: "world", project: "dice" });
    expect(saved.text).toContain("saved world at t30");
    const fixture = await readFile(out, "utf8");
    const parsed = parseSaveFile(fixture, diceGame);
    expect(parsed.ok && parsed.file).toMatchObject({
      slot: "mid",
      depth: "world",
      scene: { id: "table" },
      meta: { savedAt: 0, playTicks: 30 },
      data: { steps: 30, rolls: 30 },
    });
    expect(await readdir(join(dir, "saves"))).toEqual([
      "mid.save.json",
      "mid.save.json.asset.json",
    ]);
    const project = dice.projects.find((p) => p.file.id === "dice")!;
    expect([...(await projectSaveFixtures(project))]).toEqual([
      [(saved.data as Saved).sha256, fixture],
    ]);

    const uninterrupted = await playtest({ scene: "table", script: whole }, dice);
    const record = join(root, "resumed.rec.json");
    const resumed = await playtest(
      { scene: "table", script: await script(30), fromSave: out, record },
      dice,
    );
    expect(resumed.exitCode, resumed.text).toBe(0);
    const a = uninterrupted.data as Run;
    const b = resumed.data as Run;
    expect(b.ticks).toBe(30);
    expect(b.final).toEqual(a.final);
    expect(b.recording.end).toBe(a.recording.end);
    expect(b.recording.fromSave).toEqual({ slot: "mid", sha256: (saved.data as Saved).sha256 });
    expect(b.fromSave?.sha256).toBe((saved.data as Saved).sha256);
    expect(resumed.text).toContain(`from save ${out} (slot mid, world)`);

    const again = await save({ scene: "table", script: whole, at: "40", out, now: 0 }, dice);
    expect(again.exitCode, again.text).toBe(0);
    expect((again.data as Saved).sha256).not.toBe((saved.data as Saved).sha256);
    expect(await readFile(out, "utf8")).toContain('"playTicks": 40');

    const fuzzed = await fuzz({ scene: "table", fromSave: out, rollouts: "2", ticks: "10" }, dice);
    expect(fuzzed.exitCode, fuzzed.text).toBe(0);
    expect(fuzzed.text).toContain(`from save ${out}`);
    const missing = await fuzz({ scene: "table", fromSave: join(dir, "nope.save.json") }, dice);
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain("Not found");
  });

  it("refuses to replay a run from a save without its fixture: asset-missing, kind save", async () => {
    const { dir, dice, script } = await diceCtx();
    const out = join(dir, "saves", "start.save.json");
    const saved = await save({ scene: "table", script: await script(10), at: "10", out }, dice);
    expect(saved.exitCode, saved.text).toBe(0);
    const record = join(root, "from-save.rec.json");
    const played = await playtest(
      { scene: "table", script: await script(5), fromSave: out, record },
      dice,
    );
    expect(played.exitCode, played.text).toBe(0);
    await rm(join(dir, "saves"), { recursive: true });

    const r = await replay({ scene: "table", run: record }, dice);
    expect(r.exitCode).toBe(1);
    expect(r.data).toMatchObject({ blocked: true, stage: "load" });
    expect((r.data as { issues: unknown[] }).issues).toEqual([
      expect.objectContaining({
        code: "asset-missing",
        detail: { kind: "save", slot: "start", sha256: (saved.data as Saved).sha256 },
      }),
    ]);
  });

  it("refuses a world save of a Rapier scene with its cause, and takes a progress one", async () => {
    const script = join(root, "walk.json");
    await writeFile(script, JSON.stringify({ v: 1, steps: [{ hold: ["move_right"], for: 20 }] }));
    const out = join(root, "fixtures", "yard.save.json");
    const world = await save({ scene: "test-yard", script, at: "10", out }, ctx);
    expect(world.exitCode).toBe(1);
    expect(world.data).toMatchObject({
      ok: false,
      issue: { code: "save-unsupported" },
      causes: [
        expect.objectContaining({ cause: "physics" }),
        expect.objectContaining({ cause: "restore" }),
      ],
    });
    expect(world.text).toContain("cause physics: the scene runs on Rapier");
    expect(world.text).toContain("cause restore: the game's runtime has no `restore`");
    expect(await readdir(root)).not.toContain("fixtures");

    const progress = await save(
      { scene: "test-yard", script, at: "10", out, depth: "progress" },
      ctx,
    );
    expect(progress.exitCode, progress.text).toBe(0);
    expect(progress.data).toMatchObject({ depth: "progress", project: null });
    const file = parseSaveFile(await readFile(out, "utf8"), platformerGame);
    expect(file.ok && file.file).toMatchObject({ depth: "progress", scene: { id: "test-yard" } });
  });

  it("saves nothing when the run ends before --at, and checks its flags", async () => {
    const { dir, dice, script } = await diceCtx();
    const short = await script(5);
    const out = join(dir, "early.save.json");
    const early = await save({ scene: "table", script: short, at: "20", out }, dice);
    expect(early.exitCode).toBe(1);
    expect(early.text).toContain("before --at 20; nothing was saved");
    expect(await readdir(dir)).not.toContain("early.save.json");

    const usages = [
      { at: "20", out: join(dir, "early.json") },
      { at: "20", out: join(dir, "Early.save.json") },
      { at: "0", out },
      { at: "20", out, depth: "deep" },
      { at: "20" },
    ];
    for (const flags of usages) {
      const r = await save({ scene: "table", script: short, ...flags }, dice);
      expect(r.exitCode, JSON.stringify(flags)).toBe(2);
    }
  });
});

describe("scene flow", { timeout: 60_000 }, () => {
  type Flowed = {
    ok: boolean;
    projects: {
      project: string;
      list: { path: string } | null;
      start: string | null;
      scenes: {
        scene: string;
        start: boolean;
        sublevel?: true;
        physics: string | null;
        bundle: { blobs: number; bytes: number } | null;
      }[];
      unlisted: string[];
      issues: { code: string; severity: string }[];
    }[];
  };

  let engineDir: string;
  let engineCtx: ToolContext;
  beforeEach(async () => {
    engineDir = join(root, "engine");
    await cp(ENGINE_SCENES, engineDir, { recursive: true });
    engineCtx = { ...ctx, projects: [await tempProject(engineDir, { id: "engine" })] };
  });

  it("lists the start and each listed scene's physics and bundle bytes", async () => {
    const r = await flow({}, engineCtx);
    expect(r.exitCode, r.text).toBe(0);
    const [engine] = (r.data as Flowed).projects;
    expect(engine).toMatchObject({
      project: "engine",
      list: { path: "scene-list.json" },
      start: "engine-yard",
      unlisted: [],
      issues: [],
    });
    const rows = Object.fromEntries(engine!.scenes.map((s) => [s.scene, s]));
    expect(Object.keys(rows)).toEqual([
      "engine-yard",
      "kitchen-sink",
      "grid-yard",
      "behavior-yard",
      "grid-annex",
    ]);
    expect(rows["engine-yard"]).toMatchObject({ start: true, physics: "rapier" });
    expect(rows["grid-yard"]).toMatchObject({ start: false, physics: "none" });
    expect(rows["kitchen-sink"]!.bundle!.bytes).toBeGreaterThan(0);
    for (const row of engine!.scenes) expect(row.bundle?.bytes).toEqual(expect.any(Number));
    expect(r.text.split("\n")[0]).toBe(
      "engine: scene list scene-list.json, start engine-yard, 5 listed",
    );
    expect(r.text).toMatch(
      /^ {2}engine-yard {2}start {2}physics rapier {2}bundle \d+ blobs? \d+ B/m,
    );
    expect(r.text).toMatch(/^ {2}grid-yard {2}physics none {2}bundle /m);
  });

  it("reports the start, entries naming no scene, unlisted scenes and references flow can't follow", async () => {
    await writeFile(
      join(engineDir, "scene-list.json"),
      JSON.stringify({
        kind: "scene-list",
        v: 1,
        start: "lobby",
        scenes: [
          { scene: "engine-yard" },
          { scene: "grid-yard", sublevel: true },
          { scene: "ghost" },
        ],
      }),
    );
    const r = await flow({}, engineCtx);
    expect(r.exitCode).toBe(1);
    const [engine] = (r.data as Flowed).projects;
    expect(engine!.unlisted).toEqual(["behavior-yard", "grid-annex", "kitchen-sink"]);
    expect(engine!.scenes.find((s) => s.scene === "ghost")).toMatchObject({
      physics: null,
      bundle: null,
    });
    expect(engine!.scenes.find((s) => s.scene === "grid-yard")).toMatchObject({ sublevel: true });
    const codes = engine!.issues.map((i) => `${i.severity} ${i.code}`);
    expect(codes).toContain("error start-scene-missing");
    expect(codes).toContain("error asset-missing");
    expect(codes).toContain("warn scene-unlisted");
    expect(r.text).toContain("not listed: behavior-yard, grid-annex, kitchen-sink");
    expect(r.text).toMatch(/^ {2}ghost {2}doesn't open$/m);
  });

  it("says a project has no scene list, and refuses an unknown --project", async () => {
    const r = await flow({}, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("platformer: no scene list");
    expect((await flow({}, { ...ctx, project: "nope" })).exitCode).toBe(2);
  });
});

describe("playtest --flow", { timeout: 60_000 }, () => {
  const doorThenRoll = JSON.stringify({
    v: 1,
    steps: [
      { hold: ["door"], for: 1 },
      { hold: ["roll"], for: 10 },
    ],
  });

  it("ends the run at a request without --flow, and follows it through the scene list with it", async () => {
    const { dice } = await diceCtx();
    const script = join(root, "door.json");
    await writeFile(script, doorThenRoll);

    const ended = await playtest({ scene: "table", script }, dice);
    expect(ended.exitCode, ended.text).toBe(0);
    expect((ended.data as Run).outcome).toMatchObject({ result: "flow", to: "table-2" });

    const followed = await playtest({ scene: "table", script, flow: true }, dice);
    expect(followed.exitCode, followed.text).toBe(0);
    const run = followed.data as Run;
    expect(run.outcome.result).toBe("script-end");
    expect(run.segments?.map((s) => [s.scene, s.ticks, s.end.result, s.end.to])).toEqual([
      ["table", 1, "flow", "table-2"],
      ["table-2", 10, "script-end", undefined],
    ]);
    expect(followed.text).toContain("scene table +1 flow -> table-2");
  });

  it("needs a scene list", async () => {
    const r = await playtest({ scene: "test-yard", script: HOP_LEFT, flow: true }, ctx);
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain('project "platformer" has no scene list');
  });
});

/** The avatar game, asking for a shake and a burst on its third tick. */
const presentGame = defineGame({
  ...avatarGame,
  id: "present-game",
  createRuntime(ctx) {
    const base = avatarGame.createRuntime(ctx);
    let tick = 0;
    return {
      ...base,
      beforeStep(dt, actions, ...rest) {
        base.beforeStep?.(dt, actions, ...rest);
        if (tick++ !== 2) return;
        ctx.present.camera.shake(0.5);
        ctx.present.effects.burst("sparks", { x: 1.25, y: 2 }, { count: 3 });
      },
    };
  },
});

describe("animation, camera regions and presentation", { timeout: 60_000 }, () => {
  let sink: string;
  let sinkCtx: ToolContext;

  beforeEach(async () => {
    sink = join(root, "engine");
    await cp(ENGINE_SCENES, sink, { recursive: true });
    sinkCtx = { ...ctx, projects: [await tempProject(sink, { id: "engine" })] };
  });

  type Anim = {
    atlas: string;
    rate: number;
    clips: {
      name: string;
      loop: string;
      next: string | null;
      length: number;
      frames: { frame: string; ticks: number; events: string[]; shapes: Record<string, unknown> }[];
    }[];
    leftOut: string[];
    issues: { code: string }[];
  };

  it("assets info prints an animation's clips, frame ticks at the project's rate, events and shape sets", async () => {
    const r = await assetsInfo({ id: "kitchen-animation" }, sinkCtx);
    expect(r.exitCode, r.text).toBe(0);
    const anim = (r.data as { animation: Anim }).animation;
    expect(anim).toMatchObject({ atlas: "hero", rate: 60, leftOut: [], issues: [] });
    expect(anim.clips.map((c) => [c.name, c.loop, c.next, c.length])).toEqual([
      ["idle", "loop", null, 12],
      ["jab", "once", "idle", 14],
    ]);
    expect(anim.clips[1]!.frames).toEqual([
      { frame: "hero-0", ticks: 3, events: [], shapes: {} },
      {
        frame: "hero-1",
        ticks: 5,
        events: ["strike"],
        shapes: { hit: { minX: 0.06, minY: -0.04, maxX: 0.18, maxY: 0.04 } },
      },
      { frame: "hero-0", ticks: 6, events: [], shapes: {} },
    ]);
    expect(r.text).toContain("atlas hero; clips at 60Hz, frame lengths in ticks");
    expect(r.text).toContain("clip jab  once -> idle  3 frames, 14 ticks a pass");
    expect(r.text).toContain("1 hero-1 5t [strike] hit 0.06,-0.04..0.18,0.04 m");

    const settings = join(sink, "game-settings.json");
    const file = JSON.parse(await readFile(settings, "utf8")) as { engine: object };
    await writeFile(settings, JSON.stringify({ ...file, engine: { tickRate: 30 } }));
    const slow = await assetsInfo({ id: "kitchen-animation" }, sinkCtx);
    const at30 = (slow.data as { animation: Anim }).animation;
    expect(at30.rate).toBe(30);
    expect(at30.clips[0]!.frames.map((f) => f.ticks)).toEqual([3, 3]);
  });

  it("assets info reports an animation's issues through the animation rule and leaves the clip out", async () => {
    const path = join(sink, "art", "kitchen.animation.json");
    const file = JSON.parse(await readFile(path, "utf8")) as { clips: object[] };
    await writeFile(
      path,
      JSON.stringify({
        ...file,
        clips: [...file.clips, { name: "wave", tag: "idel", loop: "once", next: "jabb" }],
      }),
    );
    const r = await assetsInfo({ id: "kitchen-animation" }, sinkCtx);
    expect(r.exitCode, r.text).toBe(0);
    const anim = (r.data as { animation: Anim }).animation;
    expect(anim.clips.map((c) => c.name)).toEqual(["idle", "jab"]);
    expect(anim.leftOut).toEqual(["wave"]);
    expect(anim.issues.map((i) => i.code)).toEqual(["anim-tag-unknown", "anim-clip-unknown"]);
    expect(r.text).toContain("left out: wave");
    expect(r.text).toContain('error anim-tag-unknown clip "wave" names tag "idel"');
    expect(r.text).toMatch(/error anim-clip-unknown .*did you mean "jab"\?/);
  });

  it("step --anim prints the entity's clip and frame per tick", async () => {
    const r = await runCli(
      ["step", "kitchen-sink", "--ticks", "20", "--anim", "std-anim", "--events", "anim:frame"],
      sinkCtx,
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      [
        "  anim std-anim: clip, frame index and frame per tick",
        "    t0..5 idle 0 hero-0",
        "    t6..11 idle 1 hero-1",
        "    t12..17 idle 0 hero-0",
        "    t18..19 idle 1 hero-1",
      ].join("\n"),
    );
    const json = await step({ scene: "kitchen-sink", ticks: "8", anim: "std-anim" }, sinkCtx);
    const { anim } = json.data as {
      anim: { id: string; ticks: { tick: number; frame: string }[] };
    };
    expect(anim.id).toBe("std-anim");
    expect(anim.ticks.map((t) => [t.tick, t.frame])).toEqual([
      [0, "hero-0"],
      [1, "hero-0"],
      [2, "hero-0"],
      [3, "hero-0"],
      [4, "hero-0"],
      [5, "hero-0"],
      [6, "hero-1"],
      [7, "hero-1"],
    ]);
    expect(anim.ticks[6]).toMatchObject({ clip: "idle", index: 1, into: 0, playing: true });
    const plain = await step({ scene: "kitchen-sink", ticks: "8" }, sinkCtx);
    const { anim: _anim, ...rest } = json.data as Record<string, unknown>;
    expect({ ...rest, stats: undefined }).toEqual({
      ...(plain.data as Record<string, unknown>),
      stats: undefined,
    });
  });

  it("step --anim follows an entity the run spawns, with no clip until it appears", async () => {
    const path = join(sink, "kitchen-sink.json");
    const def = JSON.parse(await readFile(path, "utf8")) as {
      entities: { id: string; behaviors?: { spawner?: { fields: Record<string, unknown> } } }[];
    };
    const spawner = def.entities.find((e) => e.id === "std-spawner")!.behaviors!.spawner!;
    spawner.fields.behaviors = { anim: { clip: "idle", source: "kitchen-animation" } };
    await writeFile(path, JSON.stringify(def));
    const r = await step({ scene: "kitchen-sink", ticks: "124", anim: "solid#1" }, sinkCtx);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain(
      [
        "  anim solid#1: clip, frame index and frame per tick",
        "    t0..119 no clip",
        "    t120..123 idle 0 hero-0",
      ].join("\n"),
    );
  });

  it("step --anim refuses an entity it can't follow", async () => {
    const typo = await step({ scene: "kitchen-sink", anim: "std-anm" }, sinkCtx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain(
      'no entity "std-anm" in the scene or spawned in 120 ticks; did you mean "std-anim"?',
    );
    const plain = await step({ scene: "kitchen-sink", anim: "crate" }, sinkCtx);
    expect(plain.exitCode).toBe(2);
    expect(plain.text).toContain('"crate" has no anim block (entities with one: std-anim)');
  });

  it("show lists the camera regions as the rig reads them", async () => {
    const r = await show({ scene: "kitchen-sink" }, sinkCtx);
    expect(r.exitCode, r.text).toBe(0);
    expect((r.data as { cameraRegions: unknown }).cameraRegions).toEqual([
      {
        id: "framing",
        min: { x: 9, y: 0.5 },
        max: { x: 21, y: 7.5 },
        zoom: 1.5,
        clamp: true,
        ease: 0.5,
      },
    ]);
    expect(r.text).toContain(
      "camera regions (as the camera rig reads them):\n  framing 9,0.5..21,7.5 m zoom 1.5 clamp ease 0.5 s",
    );
    const solids = await show({ scene: "kitchen-sink", type: "solid" }, sinkCtx);
    expect((solids.data as { cameraRegions: unknown[] }).cameraRegions).toEqual([]);
    expect(solids.text).not.toContain("camera regions");
  });

  it("playtest --present lists none on a scene that asks for nothing", async () => {
    const script = join(root, "wait.json");
    await writeFile(script, JSON.stringify({ v: 2, steps: [{ wait: 10 }] }));
    const r = await playtest({ scene: "kitchen-sink", script, present: true }, sinkCtx);
    expect(r.exitCode, r.text).toBe(0);
    expect((r.data as { present: unknown[] }).present).toEqual([]);
    expect(r.text).toContain("  present: none");
  });

  it("playtest --present prints the presentation requests, which change nothing in the run", async () => {
    const dir = join(root, presentGame.id);
    await mkdir(dir);
    const yard = JSON.parse(await engineYardText()) as Record<string, unknown>;
    await writeFile(
      join(dir, "present-yard.json"),
      JSON.stringify({ ...yard, name: "present-yard", game: presentGame.id }),
    );
    const presentCtx = {
      ...ctx,
      projects: [...ctx.projects, await tempProject(dir, { game: presentGame })],
    };
    const script = join(root, "wait.json");
    await writeFile(script, JSON.stringify({ v: 2, steps: [{ wait: 5 }] }));
    const presented = await playtest({ scene: "present-yard", script, present: true }, presentCtx);
    expect(presented.exitCode, presented.text).toBe(0);
    const { present, ...run } = presented.data as { present: unknown[] };
    expect(present).toEqual([
      { kind: "camera", op: { op: "shake", trauma: 0.5 }, tick: 2 },
      {
        kind: "effect",
        op: { op: "burst", preset: "sparks", at: { x: 1.25, y: 2 }, count: 3 },
        tick: 2,
      },
    ]);
    expect(presented.text).toContain(
      [
        "  present (2, points in metres):",
        '    t2 camera shake {"trauma":0.5}',
        '    t2 effect burst {"preset":"sparks","at":{"x":1.25,"y":2},"count":3}',
      ].join("\n"),
    );
    const plain = await playtest({ scene: "present-yard", script }, presentCtx);
    expect(run).toEqual(plain.data);
    expect(presented.text.startsWith(plain.text)).toBe(true);
  });

  it("codes lists the animation and tween codes", async () => {
    const listed = (await codes({}, sinkCtx)).text;
    for (const code of [
      "anim-tag-unknown",
      "anim-clip-unknown",
      "frame-shape-invalid",
      "tween-target-invalid",
    ])
      expect(listed, code).toMatch(new RegExp(`^  ${code} +error `, "m"));
  });

  it("lists --anim and --present in the usage", async () => {
    const help = await runCli(["help"], sinkCtx);
    expect(help.stdout).toContain("[--anim id]");
    expect(help.stdout).toContain("[--present]");
  });
});
