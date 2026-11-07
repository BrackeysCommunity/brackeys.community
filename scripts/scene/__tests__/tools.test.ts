// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RigidBody } from "@dimforge/rapier2d";
import { defineGame } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import {
  AGENT_SURFACE_KEYWORD,
  AGENT_SURFACE_VERSION,
  createRegistry,
  ISSUE_CODES,
  parseSceneOrThrow,
  sceneHash,
  type OpBatch,
} from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { COMMAND_NAMES, runCli } from "../commands";
import type { ToolContext } from "../context";
import { GAMES } from "../games";
import { apply } from "../tools/apply";
import { check } from "../tools/check";
import { codes } from "../tools/codes";
import { diff } from "../tools/diff";
import { fmt } from "../tools/fmt";
import { fuzz } from "../tools/fuzz";
import { list } from "../tools/list";
import { newScene } from "../tools/new";
import { playtest } from "../tools/playtest";
import { replay } from "../tools/replay";
import { schema } from "../tools/schema";
import { MAX_ROWS, show } from "../tools/show";
import { step } from "../tools/step";
import { validate } from "../tools/validate";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const TEST_YARD = repoFile("src/games/platformer/scenes/test-yard.json");
const ENGINE_YARD = repoFile("src/engine/scenes/engine-yard.json");
const ENGINE_YARD_CHECKS = repoFile("src/engine/scenes/engine-yard.checks.json");

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
          handle === undefined ? null : (ctx.physics.world.getCollider(handle)?.parent() ?? null);
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

const PLATFORMER = createRegistry(GAMES.platformer);
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
    games: { ...GAMES, [avatarGame.id]: avatarGame },
    scenesDirs: { platformer: platformerDir, [avatarGame.id]: avatarDir },
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

  it("reports a name held by two games, and refuses to pick one", async () => {
    await copyFile(ENGINE_YARD, join(platformerDir, "engine-yard.json"));
    const r = await list({}, ctx);
    expect((r.data as { clashes: object }).clashes).toEqual({
      "engine-yard": [avatarGame.id, "platformer"],
    });
    const shown = await show({ scene: "engine-yard" }, ctx);
    expect(shown.exitCode).toBe(1);
    expect(shown.text).toContain("more than one game's scenes");
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
  it("prints the engine's or a game's schemas and refuses others", async () => {
    expect((await schema({}, ctx)).data).toMatchObject({ $id: "urn:jams-engine:scene:v2" });
    expect((await schema({ which: "ops" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:ops:v2",
    });
    expect((await schema({ game: "platformer" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:scene:platformer:v2",
    });
    expect((await schema({ which: "ops", game: "platformer" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:ops:platformer:v2",
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
    expect(def).toMatchObject({ game: "platformer", name: "fresh", v: 2 });
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
    expect(copy.$schema).toBeUndefined();
  });

  it("writes a gameless scene into the engine home", async () => {
    const engineDir = join(root, "engine");
    const withEngine: ToolContext = {
      ...ctx,
      scenesDirs: { ...ctx.scenesDirs, engine: engineDir },
    };
    const r = await newScene({ name: "blank" }, withEngine);
    expect(r.exitCode, r.text).toBe(0);
    expect(
      parseSceneOrThrow(await readFile(join(engineDir, "blank.json"), "utf8"), ENGINE),
    ).toEqual({
      v: 2,
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
  return {
    ...ctx,
    games: { ...ctx.games, [goalGame.id]: goalGame },
    scenesDirs: { ...ctx.scenesDirs, [goalGame.id]: dir },
  };
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
      "playtest",
      "replay",
      "fuzz",
      "check",
      "render",
      "textconv",
    ]);
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
    expect(JSON.parse(s.stdout).$id).toBe("urn:jams-engine:scene:platformer:v2");
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
