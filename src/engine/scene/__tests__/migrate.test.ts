import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { pointField, PathSchema, shapeField, vectorField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { scaleLengths, scaleLengthsAt } from "../../game/units";
import { formatScene } from "../format";
import { parseFragment } from "../fragment";
import { MIGRATIONS, migrate, type MigrateEnv } from "../migrate";
import { parseScene } from "../parse";
import { parsePrefab } from "../prefab";
import { SCENE_FORMAT_VERSION, type Prefab } from "../types";
import { pxToMetres } from "../units";
import { engine, metricRegistry, prefabFixture, prefabFixtures } from "./fixtures/fake-game";

const FIXTURES = new URL("./fixtures/", import.meta.url);

/**
 * sha-256 of every frozen fixture. A fixture is the format as it was
 * released, so it never changes: a new format version adds a `v<n>` folder
 * instead.
 */
const FROZEN: Record<string, string> = {
  "v1/engine-yard.json": "c560fc9a7c5c2f49c3957596e61e1fd1525da7c9894311c4231b781c6edcd80c",
  "v1/grouped.json": "3cee009bc08ba275221a8852252885fcc63c8e1dab9eb9c9baee0427555abf19",
  "v2/prefabbed.json": "3414c1a360240651ecc93751d0f83903dd5584e1981f8d0240f2f722e167fffe",
  "v3/engine-yard.json": "db031ac03957ad0c0d3f521feec8673f7a18a14a065988ca03d8c602e5252729",
  "v3/grouped.json": "0679ce3cf806dcaa1b835eebbcc514ca05b77605a2fbb0134ec54b7b2996d464",
  "v3/kitchen-sink.json": "096c23f5ad8164ecdaa23d692497d564d16d280b438e157538df82eb72dfb586",
  "v3/prefabbed.json": "ac52240a501e331e8d119b3b5409b1c757115740baaa067bac55f4cdbd15e367",
  "v3/test-game-sink.json": "bfe224af3384b43021fc3b84d0cc9fe6f3ccb36498cddbbbdef71257c48f8970",
  "v4/engine-yard.json": "b375ffa1ee7437950767410a381996df716a9a9b3c4639309be82c3081de35fb",
  "v4/grouped.json": "7039446358294bd96b837d2fd737fac092d04bebdf1a9afff309a95345fcf6da",
  "v4/kitchen-sink.json": "0345071c526ef562ec4267b975de24201005ca5b7c16ab34ea0eaa66229bdb30",
  "v4/prefabbed.json": "f8773c42da831c4e75e541b557946c8ea552d39d94f6aab8f41b9aa87226cd05",
  "v4/test-game-sink.json": "7f830d30776664aaca1b22fd83600f6e723d033d9057de5e22d39af7fc3164e4",
};

const frozenText = (file: string) => readFileSync(new URL(file, FIXTURES), "utf8");

const testGameRegistry = createRegistry(testGame);
const registryOf = (text: string): Registry =>
  (JSON.parse(text) as { game?: unknown }).game === "test-game" ? testGameRegistry : engine;

const withEngine: MigrateEnv = { registry: engine };

describe("migrate", () => {
  it("passes a current document through", () => {
    const raw = { v: SCENE_FORMAT_VERSION, name: "x" };
    expect(migrate(raw)).toEqual({ ok: true, raw, from: SCENE_FORMAT_VERSION });
    expect(Object.keys(MIGRATIONS)).toEqual(["1", "2", "3"]);
  });

  it("v1 to v2 declares each group a v1 entity names at [0, 0], so nothing moves", () => {
    const raw = JSON.parse(frozenText("v1/grouped.json")) as Record<string, unknown>;
    const r = migrate(raw, MIGRATIONS, SCENE_FORMAT_VERSION, withEngine);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    const out = MIGRATIONS[1]!(raw, {}) as Record<string, unknown>;
    expect(out.v).toBe(2);
    expect(out.groups).toEqual({ markers: { at: [0, 0] }, posts: { at: [0, 0] } });
    expect(out.entities).toEqual(raw.entities);
    expect(migrate({ v: 1, name: "x" }, MIGRATIONS, SCENE_FORMAT_VERSION, withEngine)).toEqual({
      ok: true,
      raw: { v: SCENE_FORMAT_VERSION, name: "x" },
      from: 1,
    });
    expect(raw.v).toBe(1);
  });

  it("v2 to v3 changes only v, on scenes, prefabs and fragments alike", () => {
    const scene = JSON.parse(frozenText("v2/prefabbed.json")) as Record<string, unknown>;
    const prefab = {
      kind: "prefab",
      v: 2,
      id: "gate",
      entities: [{ id: "bar", type: "solid", shape: ["box", 0, 0, 40, 6] }],
    };
    const fragment = {
      kind: "scene-fragment",
      v: 2,
      entities: [{ id: "start", type: "marker", at: [0, 0] }],
    };
    for (const raw of [scene, prefab, fragment, { v: 2 }]) {
      const before = structuredClone(raw);
      const r = migrate(raw, MIGRATIONS, 3);
      expect(r).toEqual({ ok: true, raw: { ...before, v: 3 }, from: 2 });
      expect(raw).toEqual(before);
    }
    const parsedPrefab = parsePrefab(JSON.stringify(prefab), engine);
    expect(parsedPrefab.ok && parsedPrefab.migratedFrom).toBe(2);
    expect(parsedPrefab.ok && parsedPrefab.prefab.v).toBe(SCENE_FORMAT_VERSION);
    const parsedFragment = parseFragment(JSON.stringify(fragment), engine);
    expect(parsedFragment.ok && parsedFragment.migratedFrom).toBe(2);
    expect(parsedFragment.ok && parsedFragment.fragment.v).toBe(SCENE_FORMAT_VERSION);
  });

  it("rejects a missing or invalid v as schema", () => {
    for (const raw of [{}, { v: "1" }, { v: 0 }, { v: 1.5 }, [], null]) {
      const r = migrate(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("schema");
    }
  });

  it("refuses a newer version", () => {
    const r = migrate({ v: SCENE_FORMAT_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.code).toBe("version-newer");
      expect(r.issue.path).toBe("/v");
    }
  });

  it("runs each step in order up to the target", () => {
    const steps = {
      1: (raw: unknown) => ({ ...(raw as object), v: 2, a: true }),
      2: (raw: unknown) => ({ ...(raw as object), v: 3, b: true }),
    };
    expect(migrate({ v: 1 }, steps, 3)).toEqual({
      ok: true,
      raw: { v: 3, a: true, b: true },
      from: 1,
    });
    const gap = migrate({ v: 1 }, { 1: steps[1] }, 3);
    expect(gap.ok === false && gap.issue.message).toContain("v2 to v3");
  });
});

describe("the migration harness", () => {
  it("has one step per version and a frozen fixture folder per version", () => {
    const steps = Object.keys(MIGRATIONS).map(Number);
    expect(steps).toEqual(Array.from({ length: SCENE_FORMAT_VERSION - 1 }, (_, i) => i + 1));
    const folders = readdirSync(FIXTURES).filter((f) => /^v\d+$/.test(f));
    expect(folders.sort()).toEqual(
      Array.from({ length: SCENE_FORMAT_VERSION }, (_, i) => `v${i + 1}`).sort(),
    );
  });

  it("keeps every frozen fixture byte for byte", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => /^v\d+$/.test(f))
      .flatMap((v) => readdirSync(new URL(`${v}/`, FIXTURES)).map((f) => `${v}/${f}`));
    expect(files.sort()).toEqual(Object.keys(FROZEN).sort());
    for (const [file, sha] of Object.entries(FROZEN))
      expect(createHash("sha256").update(frozenText(file)).digest("hex"), file).toBe(sha);
  });

  for (const file of Object.keys(FROZEN)) {
    it(`walks ${file} to the current version and round-trips it`, () => {
      const from = Number(file.slice(1, file.indexOf("/")));
      const opts = { prefab: prefabFixture };
      const parsed = parseScene(frozenText(file), registryOf(frozenText(file)), opts);
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      expect(parsed.migratedFrom).toBe(from === SCENE_FORMAT_VERSION ? undefined : from);
      const { text } = formatScene(parsed.def);
      const again = parseScene(text, registryOf(text));
      expect(again.ok && formatScene(again.def).text).toBe(text);
      if (from === SCENE_FORMAT_VERSION) expect(text).toBe(frozenText(file));
    });
  }

  it("composes steps on a real fixture", () => {
    const steps = {
      1: (raw: unknown) => {
        const { bounds, ...rest } = raw as Record<string, unknown>;
        return { ...rest, v: 2, rect: bounds };
      },
      2: (raw: unknown) => {
        const { rect, ...rest } = raw as Record<string, unknown>;
        return { ...rest, v: 3, bounds: rect, migrated: true };
      },
    };
    const raw = JSON.parse(frozenText("v1/engine-yard.json")) as Record<string, unknown>;
    const r = migrate(raw, steps, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    expect(r.raw).toEqual({ ...raw, v: 3, migrated: true });
    expect(raw.v).toBe(1);
  });
});

/** `raw` at v3 lifted to v4, or the refusal's issue. */
function lift(raw: Record<string, unknown>, env: MigrateEnv): Record<string, unknown> {
  const r = migrate(raw, MIGRATIONS, 4, env);
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.raw as Record<string, unknown>;
}

function refusal(raw: Record<string, unknown>, env: MigrateEnv) {
  const r = migrate(raw, MIGRATIONS, 4, env);
  expect(r.ok).toBe(false);
  return r.ok ? undefined : r.issue;
}

const scene = (rest: Record<string, unknown>): Record<string, unknown> => ({
  v: 3,
  game: "metric",
  name: "units",
  bounds: [0, 0, 960, 480],
  ...rest,
});

const get = (v: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], v);

/**
 * One site per row: a v3 document, where the value lands, and what it held
 * in px (numbers) or what it keeps (anything else).
 */
type Site = {
  name: string;
  doc: Record<string, unknown>;
  path: (string | number)[];
  px: unknown;
  /** Positions in `px` that aren't lengths (a shape's rotDeg), kept as they are. */
  keep?: number[];
};

const SITES: Site[] = [
  {
    name: "bounds",
    doc: scene({ bounds: [-96, -48, 960, 480] }),
    path: ["bounds"],
    px: [-96, -48, 960, 480],
  },
  {
    name: "settings.gravity",
    doc: scene({ settings: { gravity: [5, 1200] } }),
    path: ["settings", "gravity"],
    px: [5, 1200],
  },
  {
    name: "a square grid's cell and origin",
    doc: scene({ settings: { grid: { kind: "square", cell: [32, 48], origin: [16, 5] } } }),
    path: ["settings", "grid"],
    px: { kind: "square", cell: [32, 48], origin: [16, 5] },
  },
  {
    name: "a hex grid's cell, side and origin",
    doc: scene({
      settings: {
        grid: { kind: "hex", cell: [64, 56], side: 32, stagger: "x", index: "odd", origin: [3, 7] },
      },
    }),
    path: ["settings", "grid"],
    px: { kind: "hex", cell: [64, 56], side: 32, stagger: "x", index: "odd", origin: [3, 7] },
  },
  {
    name: "a game setting in m",
    doc: scene({ settings: { floorY: 450, label: "x" } }),
    path: ["settings", "floorY"],
    px: 450,
  },
  {
    name: "a game setting in m/s",
    doc: scene({ settings: { maxFall: 900 } }),
    path: ["settings", "maxFall"],
    px: 900,
  },
  {
    name: "a group's at",
    doc: scene({ groups: { wing: { at: [400, 5], rot: 2 } } }),
    path: ["groups", "wing"],
    px: { at: [400, 5], rot: 2 },
  },
  {
    name: "an instance's at",
    doc: scene({ instances: [{ id: "p-1", prefab: "post", at: [100, 7], rot: 3, z: 2 }] }),
    path: ["instances", 0],
    px: { id: "p-1", prefab: "post", at: [100, 7], rot: 3, z: 2 },
  },
  {
    name: "a box with its rotation",
    doc: scene({ entities: [{ id: "s", type: "solid", shape: ["box", 100, 50, 25, 5, 30] }] }),
    path: ["entities", 0, "shape"],
    px: ["box", 100, 50, 25, 5, 30],
    keep: [5],
  },
  {
    name: "a circle",
    doc: scene({ entities: [{ id: "c", type: "prop", shape: ["circle", 10, 20, 5], density: 2 }] }),
    path: ["entities", 0, "shape"],
    px: ["circle", 10, 20, 5],
  },
  {
    name: "a capsule with its rotation",
    doc: scene({ entities: [{ id: "c", type: "prop", shape: ["capsule", 10, 20, 15, 5, 45] }] }),
    path: ["entities", 0, "shape"],
    px: ["capsule", 10, 20, 15, 5, 45],
    keep: [5],
  },
  {
    name: "a polygon",
    doc: scene({ entities: [{ id: "p", type: "solid", shape: ["poly", 0, 0, 50, 0, 25, 40] }] }),
    path: ["entities", 0, "shape"],
    px: ["poly", 0, 0, 50, 0, 25, 40],
  },
  {
    name: "a chain",
    doc: scene({ entities: [{ id: "c", type: "solid", shape: ["chain", 0, 0, 50, 5] }] }),
    path: ["entities", 0, "shape"],
    px: ["chain", 0, 0, 50, 5],
  },
  {
    name: "an entity's point",
    doc: scene({ entities: [{ id: "m", type: "marker", at: [300, 5], tags: ["spawn"] }] }),
    path: ["entities", 0, "at"],
    px: [300, 5],
  },
  {
    name: "a path's points and speed, not its pause",
    doc: scene({
      entities: [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 60, 8],
          path: {
            pts: [
              [1700, 900],
              [1700, 5],
            ],
            mode: "ping_pong",
            speed: 80,
            pauseMs: 400,
          },
        },
      ],
    }),
    path: ["entities", 0, "path"],
    px: {
      pts: [
        [1700, 900],
        [1700, 5],
      ],
      mode: "ping_pong",
      speed: 80,
      pauseMs: 400,
    },
  },
  {
    name: "a bulk shape",
    doc: scene({ solid: [["box", 500, 470, 500, 5]] }),
    path: ["solid", 0],
    px: ["box", 500, 470, 500, 5],
  },
  {
    name: "a bulk shape by material",
    doc: scene({ "plate:ice": [["box", 50, 47, 50, 5, 90]] }),
    path: ["plate:ice", 0],
    px: ["box", 50, 47, 50, 5, 90],
    keep: [5],
  },
  { name: "a bulk point", doc: scene({ beacon: [[96, 5]] }), path: ["beacon", 0], px: [96, 5] },
  {
    name: "a game field in m, a default, an array of vectors, a record and a tuple with rest",
    doc: scene({
      entities: [
        {
          id: "b",
          type: "beacon",
          at: [0, 0],
          reach: 250,
          pad: 5,
          offsets: [
            [10, -5],
            [3, 0],
          ],
          ranges: { near: 50, far: 500 },
          span: ["arc", 10, 20],
          weight: 3,
        },
      ],
    }),
    path: ["entities", 0],
    px: {
      id: "b",
      type: "beacon",
      at: [0, 0],
      reach: 250,
      pad: 5,
      offsets: [
        [10, -5],
        [3, 0],
      ],
      ranges: { near: 50, far: 500 },
      span: ["arc", 10, 20],
      weight: 3,
    },
  },
  {
    name: "a discriminated union's point, not its angle",
    doc: scene({
      entities: [
        { id: "b", type: "beacon", at: [0, 0], aim: { kind: "point", at: [96, 5] } },
        { id: "c", type: "beacon", at: [0, 0], aim: { kind: "angle", deg: 90 } },
      ],
    }),
    path: ["entities"],
    px: [
      { id: "b", type: "beacon", at: [0, 0], aim: { kind: "point", at: [96, 5] } },
      { id: "c", type: "beacon", at: [0, 0], aim: { kind: "angle", deg: 90 } },
    ],
  },
  {
    name: "a behavior's lengths, not its degrees or ms",
    doc: scene({
      entities: [
        {
          id: "b",
          type: "beacon",
          at: [0, 0],
          behaviors: { "metric/hover": { height: 48, rise: 96, turn: 180, delayMs: 300 } },
        },
      ],
    }),
    path: ["entities", 0, "behaviors", "metric/hover"],
    px: { height: 48, rise: 96, turn: 180, delayMs: 300 },
  },
];

/** What a site's px value is in metres at `ppm`, by the unit sites the rows name. */
function inMetres(site: Site, ppm: number): unknown {
  const m = (n: number) => pxToMetres(n, ppm);
  const keepAt = new Set(site.keep ?? []);
  const NOT_LENGTHS = new Set([
    "rot",
    "z",
    "turn",
    "delayMs",
    "pauseMs",
    "density",
    "weight",
    "deg",
  ]);
  const conv = (v: unknown, key?: string, i?: number): unknown => {
    if (typeof v === "number")
      return key && NOT_LENGTHS.has(key) ? v : i !== undefined && keepAt.has(i) ? v : m(v);
    if (Array.isArray(v)) return v.map((x, j) => conv(x, key, Array.isArray(x) ? undefined : j));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x, k)]));
    return v;
  };
  return conv(site.px);
}

describe("v3 → v4", () => {
  for (const ppm of [100, 32, 48]) {
    const registry = metricRegistry(ppm);
    const env: MigrateEnv = { registry, prefab: prefabFixture };
    describe(`at ${ppm} px per metre`, () => {
      for (const site of SITES)
        it(`moves ${site.name} to metres`, () => {
          const out = lift(site.doc, env);
          expect(out.v).toBe(4);
          expect(get(out, ...site.path)).toEqual(inMetres(site, ppm));
        });

      it("writes every length by the one rounding rule", () => {
        const out = lift(scene({ entities: [{ id: "m", type: "marker", at: [5, 1] }] }), env);
        expect(get(out, "entities", 0, "at")).toEqual([pxToMetres(5, ppm), pxToMetres(1, ppm)]);
        if (ppm === 48) expect(get(out, "entities", 0, "at")).toEqual([0.104167, 0.020833]);
      });

      it("moves a prefab's contract, its bulk, entities and nested instances", () => {
        const prefab = {
          kind: "prefab",
          v: 3,
          game: "metric",
          id: "bay",
          contract: { reach: 480 },
          bulk: { solid: [["box", 0, 10, 96, 5]] },
          instances: [{ id: "g", prefab: "gate", at: [96, 0] }],
          entities: [{ id: "top", type: "marker", at: [0, -48] }],
        };
        const out = lift(prefab, env);
        expect(out).toEqual({
          ...prefab,
          v: 4,
          contract: { reach: pxToMetres(480, ppm) },
          bulk: {
            solid: [["box", 0, pxToMetres(10, ppm), pxToMetres(96, ppm), pxToMetres(5, ppm)]],
          },
          instances: [{ id: "g", prefab: "gate", at: [pxToMetres(96, ppm), 0] }],
          entities: [{ id: "top", type: "marker", at: [0, pxToMetres(-48, ppm)] }],
        });
      });
    });
  }

  it("leaves a document's other values and keys as they are", () => {
    const doc = scene({
      settings: { physics: "none", view: { projection: "orthogonal" }, label: "x" },
      assets: ["a"],
      entities: [{ id: "n", type: "note", at: [0, 0], text: "100 px", off: true, z: 3 }],
    });
    const out = lift(doc, { registry: metricRegistry(100) });
    expect(out.settings).toEqual(doc.settings);
    expect(out.assets).toEqual(["a"]);
    expect(out.entities).toEqual([
      { id: "n", type: "note", at: [0, 0], text: "100 px", off: true, z: 3 },
    ]);
  });

  it("doesn't change its input", () => {
    const doc = SITES[0]!.doc;
    const before = structuredClone(doc);
    lift(doc, { registry: metricRegistry(32) });
    expect(doc).toEqual(before);
  });
});

describe("v3 → v4 overrides and params", () => {
  const env: MigrateEnv = { registry: engine, prefab: prefabFixture };
  const room = (inst: Record<string, unknown>) => ({
    v: 3,
    name: "rooms",
    bounds: [0, 0, 2000, 1000],
    instances: [{ id: "room-1", prefab: "room", at: [500, 500], ...inst }],
  });

  it("scales a nested override through the prefab that holds the child", () => {
    const out = lift(
      room({
        overrides: {
          "door-1/panel.path.speed": 50,
          "door-1/panel.path.pts": [
            [0, 0],
            [0, -60],
          ],
          "door-1/latch/door.path.speed": 30,
          "door-1/frame.shape": ["box", 0, 0, 30, 50, 15],
          "door-1.at": [10, 40],
          "door-1.z": 2,
          "~solid:0.shape": ["box", 0, 100, 400, 10],
          "lamp.at": [0, -100],
          "lamp.tags": ["light", "red"],
        },
      }),
      env,
    );
    expect(get(out, "instances", 0, "overrides")).toEqual({
      "door-1/panel.path.speed": 0.5,
      "door-1/panel.path.pts": [
        [0, 0],
        [0, -0.6],
      ],
      "door-1/latch/door.path.speed": 0.3,
      "door-1/frame.shape": ["box", 0, 0, 0.3, 0.5, 15],
      "door-1.at": [0.1, 0.4],
      "door-1.z": 2,
      "~solid:0.shape": ["box", 0, 1, 4, 0.1],
      "lamp.at": [0, -1],
      "lamp.tags": ["light", "red"],
    });
    expect(get(out, "instances", 0, "at")).toEqual([5, 5]);
  });

  it("scales an exposed param through its target, on a variant through its base", () => {
    const out = lift(
      {
        v: 3,
        name: "gates",
        bounds: [0, 0, 2000, 1000],
        instances: [
          { id: "g-1", prefab: "red-gate", at: [0, 0], params: { speed: 90 } },
          { id: "g-2", prefab: "gate", at: [0, 0], params: { speed: 120 } },
          { id: "r-1", prefab: "room", at: [0, 0], overrides: { "door-1.params.speed": 40 } },
        ],
      },
      { registry: engine, prefab: (id) => (id === "door" ? doorWithParam : prefabFixture(id)) },
    );
    expect(get(out, "instances", 0, "params")).toEqual({ speed: 0.9 });
    expect(get(out, "instances", 1, "params")).toEqual({ speed: 1.2 });
    expect(get(out, "instances", 2, "overrides")).toEqual({ "door-1.params.speed": 0.4 });
  });

  it("scales a prefab file's instances, variant overrides and param defaults", () => {
    const red = lift(
      prefabFixtures["red-gate"] as unknown as Record<string, unknown>,
      env,
    ) as unknown as Prefab;
    expect(red.params).toEqual({
      speed: {
        default: 0.9,
        description: "How fast the door opens, in px per second.",
        targets: ["door.path.speed"],
      },
    });
    expect(red.overrides).toEqual({ "door.z": 1, "trigger.tags": ["gate", "red"] });
    expect(red.entities).toEqual([
      { id: "lamp", type: "marker", at: [0.2, -0.9], tags: ["light"] },
    ]);
    const roomFile = lift(
      prefabFixtures.room as unknown as Record<string, unknown>,
      env,
    ) as unknown as Prefab;
    expect(roomFile.instances).toEqual([
      { id: "gate-1", prefab: "gate", at: [-2, 0] },
      {
        id: "gate-2",
        prefab: "gate",
        at: [2, 0],
        rot: 2,
        flip: true,
        overrides: { "door.path.speed": 0.9 },
      },
      {
        id: "door-1",
        prefab: "door",
        z: 2,
        at: [0, 0.4],
        overrides: { "latch/door.path.speed": 0.3, "panel.path.speed": 0.5 },
      },
    ]);
  });

  it("needs no prefab for values without a number", () => {
    const doc = room({ overrides: { "lamp.tags": ["x"], "door-1.off": true } });
    const out = lift(doc, withEngine);
    expect(get(out, "instances", 0, "overrides")).toEqual({
      "lamp.tags": ["x"],
      "door-1.off": true,
    });
  });

  it("parses a prefab and a scene through the lookup it is given", () => {
    const parsed = parsePrefab(JSON.stringify(prefabFixtures.room), engine, {
      prefab: prefabFixture,
    });
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);
    if (parsed.ok)
      expect(parsed.prefab.instances?.[2]?.overrides).toEqual({
        "latch/door.path.speed": 0.3,
        "panel.path.speed": 0.5,
      });
    const def = parseScene(
      JSON.stringify(room({ params: {}, overrides: { "door-1/panel.path.speed": 50 } })),
      engine,
      { prefab: prefabFixture },
    );
    expect(def.ok && def.def.instances?.[0]?.overrides).toEqual({ "door-1/panel.path.speed": 0.5 });
  });
});

const doorWithParam: Prefab = {
  ...prefabFixtures.door!,
  params: { speed: { description: "Panel speed.", targets: ["panel.path.speed"] } },
};

describe("v3 → v4 refusals", () => {
  const doc = {
    v: 3,
    name: "rooms",
    bounds: [0, 0, 2000, 1000],
    instances: [
      {
        id: "room-1",
        prefab: "room",
        at: [500, 500],
        overrides: { "door-1/panel.path.speed": 50 },
      },
    ],
  };

  it("refuses without a registry", () => {
    const issue = refusal({ v: 3, name: "x", bounds: [0, 0, 10, 10] }, {});
    expect(issue).toMatchObject({ code: "migration-unresolved", severity: "error", path: "/v" });
    expect(issue?.message).toContain("registry");
  });

  it("refuses an override whose prefab it wasn't given, naming the path", () => {
    const issue = refusal(doc, withEngine);
    expect(issue).toMatchObject({
      code: "migration-unresolved",
      path: "/instances/0/overrides/door-1~1panel.path.speed",
    });
    expect(issue?.message).toContain('prefab "room"');
    const missing = refusal(doc, { registry: engine, prefab: () => undefined });
    expect(missing?.message).toContain(`prefab "room" isn't in the project`);
  });

  it("refuses an override of a nested prefab it can't find", () => {
    const issue = refusal(doc, {
      registry: engine,
      prefab: (id) => (id === "room" ? prefabFixture(id) : undefined),
    });
    expect(issue).toMatchObject({
      code: "migration-unresolved",
      path: "/instances/0/overrides/door-1~1panel.path.speed",
    });
    expect(issue?.message).toContain('prefab "door"');
  });

  it("refuses an override of a child or field the prefab hasn't got", () => {
    const env: MigrateEnv = { registry: engine, prefab: prefabFixture };
    for (const key of ["ghost.path.speed", "door-1/ghost.path.speed", "lamp.reach", "lamp.at.2"]) {
      const issue = refusal(
        { ...doc, instances: [{ ...doc.instances[0]!, overrides: { [key]: 5 } }] },
        env,
      );
      expect(issue?.code, key).toBe("migration-unresolved");
      expect(issue?.path, key).toBe(`/instances/0/overrides/${key.replace("/", "~1")}`);
    }
  });

  it("refuses a param the prefab doesn't expose", () => {
    const issue = refusal(
      { ...doc, instances: [{ id: "g", prefab: "gate", at: [0, 0], params: { width: 50 } }] },
      { registry: engine, prefab: prefabFixture },
    );
    expect(issue).toMatchObject({
      code: "migration-unresolved",
      path: "/instances/0/params/width",
    });
  });

  it("refuses a scene for another game as unknown-game", () => {
    expect(refusal({ ...doc, game: "elsewhere" }, withEngine)?.code).toBe("unknown-game");
  });

  it("refuses through parseScene without a prefab lookup", () => {
    const parsed = parseScene(JSON.stringify(doc), engine);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.code).toBe("migration-unresolved");
  });
});

describe("scaleLengths", () => {
  const m = (n: number) => pxToMetres(n, 100);
  it("divides numbers under a length unit through every kind of schema", () => {
    const schema = z.strictObject({
      at: pointField("A point."),
      dir: vectorField("A direction."),
      path: PathSchema.optional(),
      shape: shapeField("A shape."),
      far: z.number().default(10).meta({ unit: "m" }),
      list: z.array(z.number().meta({ unit: "m/s" })),
      byName: z.record(z.string(), z.number().meta({ unit: "m/s²" })),
      pair: z.tuple([z.number().meta({ unit: "deg" }), z.number().meta({ unit: "m" })]),
      either: z.union([z.string(), z.number().meta({ unit: "m" })]),
      nested: z.object({ deep: z.object({ len: z.number().meta({ unit: "m" }), n: z.number() }) }),
      count: z.number(),
    });
    expect(
      scaleLengths(
        {
          at: [100, 50],
          dir: [3, -4],
          path: {
            pts: [
              [0, 0],
              [100, 0],
            ],
            mode: "loop",
            speed: 60,
            pauseMs: 100,
          },
          shape: ["box", 10, 20, 30, 40, 90],
          far: 250,
          list: [1, 2],
          byName: { g: 1200 },
          pair: [45, 45],
          either: 70,
          nested: { deep: { len: 5, n: 5 } },
          count: 7,
          extra: 9,
        },
        schema,
        100,
      ),
    ).toEqual({
      at: [1, 0.5],
      dir: [m(3), m(-4)],
      path: {
        pts: [
          [0, 0],
          [1, 0],
        ],
        mode: "loop",
        speed: 0.6,
        pauseMs: 100,
      },
      shape: ["box", 0.1, 0.2, 0.3, 0.4, 90],
      far: 2.5,
      list: [0.01, 0.02],
      byName: { g: 12 },
      pair: [45, 0.45],
      either: 0.7,
      nested: { deep: { len: 0.05, n: 5 } },
      count: 7,
      extra: 9,
    });
  });

  it("returns other values unchanged and writes no -0", () => {
    const schema = z.number().meta({ unit: "m" });
    expect(scaleLengths("x", schema, 100)).toBe("x");
    expect(Object.is(scaleLengths(-0.0000001, schema, 100), 0)).toBe(true);
  });

  it("scales the value at a field path", () => {
    expect(scaleLengthsAt(80, PathSchema, ["speed"], 100)).toEqual({ value: 0.8 });
    expect(scaleLengthsAt(5, vectorField("v"), ["1"], 100)).toEqual({ value: 0.05 });
    expect(scaleLengthsAt(400, PathSchema, ["pauseMs"], 100)).toEqual({ value: 400 });
    expect(scaleLengthsAt(1, PathSchema, ["nope"], 100)).toBeNull();
  });
});
