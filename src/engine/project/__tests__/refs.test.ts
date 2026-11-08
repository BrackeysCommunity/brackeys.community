import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { sequentialKeys } from "../../collab/keys";
import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { assetField, materialField, pointField, shapeField } from "../../game/fields";
import type { FieldEnv } from "../../game/types";
import {
  createKindRegistry,
  defineAssetKind,
  type AssetKindDef,
  type KindEnv,
  type KindRegistry,
} from "../kinds";
import { checkProjectBatch } from "../ops";
import {
  buildRefIndex,
  inUseIssue,
  namesAt,
  referencedTrash,
  rewriteRefs,
  schemaRefSites,
  type RefSite,
} from "../refs";
import type { AssetEntry, AssetId, ProjectView } from "../types";
import { projectView } from "../view";

type Level = {
  instances: { id: string; prefab: string }[];
  entities: { id: string; material?: string }[];
};

const level = defineAssetKind({
  kind: "level",
  title: "Level",
  description: "A test level.",
  match: { suffixes: [".level.json"] },
  storage: "doc",
  version: 1,
  schemaId: "urn:test:level:v1",
  schema: () =>
    z.object({
      instances: z.array(z.object({ id: z.string(), prefab: z.string() })),
      entities: z.array(z.object({ id: z.string(), material: z.string().optional() })),
    }),
  layout: { as: "atomic" },
  empty: () => ({ instances: [], entities: [] }),
  refs: (value: Level): RefSite[] => [
    ...value.instances.map((inst) => ({
      pointer: `/instances/@${inst.id}/prefab`,
      id: inst.prefab,
      kinds: ["prefab"],
    })),
    ...value.entities.flatMap((e, i) =>
      e.material
        ? [{ pointer: `/entities/${i}/material`, id: e.material, kinds: ["material"] }]
        : [],
    ),
  ],
});

const docKind = (kind: string) =>
  defineAssetKind({
    kind,
    title: kind,
    description: `A test ${kind}.`,
    match: { jsonKind: kind },
    storage: "doc",
    version: 1,
    schemaId: `urn:test:${kind}:v1`,
    schema: () => z.object({}),
    layout: { as: "map" },
    empty: () => ({}),
  });

const texture = defineAssetKind({
  kind: "texture",
  title: "Texture",
  description: "A test image.",
  match: { suffixes: [".png"] },
  storage: "blob",
  contentTypes: ["image/png"],
  maxBytes: 1 << 20,
  settings: z.object({}),
  meta: z.object({}),
  inspect: () => ({ ok: true, meta: {} }),
});

const atlas = defineAssetKind({
  kind: "atlas",
  title: "Atlas",
  description: "A test atlas.",
  match: { suffixes: [".atlas.json"] },
  storage: "blob",
  contentTypes: ["application/json"],
  maxBytes: 1 << 20,
  settings: z.object({ texture: z.string().optional() }),
  meta: z.object({}),
  inspect: () => ({ ok: true, meta: {} }),
  refs: (entry: AssetEntry): RefSite[] =>
    typeof entry.import?.texture === "string"
      ? [{ pointer: "/import/texture", id: entry.import.texture, kinds: ["texture"] }]
      : [],
});

const ALL: AssetKindDef[] = [level, docKind("prefab"), docKind("material"), texture, atlas];

const kinds: KindRegistry = {
  get: (kind) => ALL.find((k) => k.kind === kind),
  list: () => ALL,
  detect: () => null,
  schemaHashes: async () => ({}),
};

let clock = 0;
function entry(
  id: AssetId,
  kind: string,
  extra: Partial<AssetEntry> & { key?: string } = {},
): AssetEntry {
  clock += 1;
  const blob = kind === "texture" || kind === "atlas";
  return {
    key: extra.key ?? id,
    id,
    kind,
    path: `${id}.${kind}`,
    created: { at: clock, by: "test" },
    ...(blob ? { sha256: "0".repeat(64), bytes: 1 } : {}),
    ...extra,
  };
}

const trashed = (at: number) => ({ deleted: { at, by: "test" } });

function viewOf(entries: AssetEntry[]): ProjectView {
  const live = entries.filter((e) => !e.deleted);
  return {
    state: {
      meta: { projectId: "test", layout: 1, name: "Test" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    byId: new Map(live.map((e) => [e.id, e])),
    byPath: new Map(live.map((e) => [e.path, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
    deleted: entries.filter((e) => e.deleted),
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };
}

const envOf = (view: ProjectView): KindEnv => ({ registry: createRegistry(), project: view });

function index(entries: AssetEntry[], values: Record<AssetId, unknown>) {
  const view = viewOf(entries);
  return { view, index: buildRefIndex(view, new Map(Object.entries(values)), kinds, envOf(view)) };
}

const world: Level = {
  instances: [
    { id: "a", prefab: "crate" },
    { id: "b", prefab: "gate" },
  ],
  entities: [{ id: "floor", material: "rubber" }, { id: "wall" }],
};

describe("buildRefIndex", () => {
  it("indexes doc and blob references both ways", () => {
    const { index: refs } = index(
      [
        entry("world", "level"),
        entry("cave", "level"),
        entry("crate", "prefab"),
        entry("gate", "prefab"),
        entry("rubber", "material"),
        entry("tiles", "texture"),
        entry("sheet", "atlas", { import: { texture: "tiles" } }),
      ],
      {
        world,
        cave: { instances: [{ id: "c", prefab: "crate" }], entities: [] },
      },
    );

    expect(refs.targets("world")).toEqual([
      { pointer: "/instances/@a/prefab", id: "crate", kinds: ["prefab"] },
      { pointer: "/instances/@b/prefab", id: "gate", kinds: ["prefab"] },
      { pointer: "/entities/0/material", id: "rubber", kinds: ["material"] },
    ]);
    expect(refs.referrers("crate")).toEqual([
      { id: "cave", kind: "level", pointer: "/instances/@c/prefab" },
      { id: "world", kind: "level", pointer: "/instances/@a/prefab" },
    ]);
    expect(refs.referrers("rubber")).toEqual([
      { id: "world", kind: "level", pointer: "/entities/0/material" },
    ]);
    expect(refs.referrers("tiles")).toEqual([
      { id: "sheet", kind: "atlas", pointer: "/import/texture" },
    ]);
    expect(refs.targets("crate")).toEqual([]);
    expect(refs.referrers("world")).toEqual([]);
    expect(refs.dangling()).toEqual([]);
  });

  it("reads only the docs it's given, and only live referrers", () => {
    const { index: refs } = index(
      [entry("world", "level"), entry("old", "level", trashed(5)), entry("gate", "prefab")],
      { old: world },
    );
    expect(refs.targets("world")).toEqual([]);
    expect(refs.targets("old")).toEqual([]);
    expect(refs.referrers("gate")).toEqual([]);
    expect(refs.dangling()).toEqual([]);
  });

  it("reports dangling references as asset-missing with a did-you-mean", () => {
    const { index: refs } = index(
      [entry("world", "level"), entry("crates", "prefab"), entry("gate", "texture")],
      { world },
    );
    const issues = refs.dangling();
    expect(issues.map((i) => [i.code, i.severity, i.got, i.path, i.entityIds])).toEqual([
      ["asset-missing", "error", "crate", "/instances/@a/prefab", ["world"]],
      ["asset-missing", "error", "gate", "/instances/@b/prefab", ["world"]],
    ]);
    expect(issues[0]!.message).toBe(
      `"world" names prefab "crate" at /instances/@a/prefab, but the project has no live prefab "crate"; did you mean "crates"?`,
    );
    expect(issues[0]!.expected).toBe("prefab");
    expect(issues[1]!.message).toBe(
      `"world" names prefab "gate" at /instances/@b/prefab, but "gate" is a texture.`,
    );
    expect(refs.referrers("crate")).toEqual([
      { id: "world", kind: "level", pointer: "/instances/@a/prefab" },
    ]);
  });

  it("says when the named asset is in the trash", () => {
    const { index: refs } = index(
      [entry("world", "level"), entry("crate", "prefab", trashed(9)), entry("gate", "prefab")],
      { world },
    );
    expect(refs.dangling().map((i) => i.message)).toEqual([
      `"world" names prefab "crate" at /instances/@a/prefab, but it's in the trash.`,
    ]);
  });

  it("counts material fields only when a material asset has the name", () => {
    const value: Level = {
      instances: [],
      entities: [
        { id: "a", material: "ice" },
        { id: "b", material: "rubber" },
      ],
    };
    const code = index([entry("world", "level")], { world: value }).index;
    expect(code.targets("world")).toEqual([]);
    expect(code.referrers("ice")).toEqual([]);
    expect(code.dangling()).toEqual([]);

    const asTexture = index([entry("world", "level"), entry("ice", "texture")], {
      world: value,
    }).index;
    expect(asTexture.targets("world")).toEqual([]);

    const live = index([entry("world", "level"), entry("rubber", "material")], {
      world: value,
    }).index;
    expect(live.targets("world").map((s) => s.id)).toEqual(["rubber"]);
    expect(live.dangling()).toEqual([]);

    const gone = index([entry("world", "level"), entry("rubber", "material", trashed(3))], {
      world: value,
    }).index;
    expect(gone.referrers("rubber")).toEqual([
      { id: "world", kind: "level", pointer: "/entities/1/material" },
    ]);
    expect(gone.dangling().map((i) => [i.code, i.got])).toEqual([["asset-missing", "rubber"]]);
  });
});

describe("referencedTrash", () => {
  it("lists the trashed entries a live value names", () => {
    const { view, index: refs } = index(
      [
        entry("world", "level"),
        entry("crate", "prefab", { key: "k-crate-old", ...trashed(1) }),
        entry("crate", "prefab", { key: "k-crate", ...trashed(7) }),
        entry("gate", "prefab", trashed(2)),
        entry("gate", "prefab", { key: "k-gate-live" }),
        entry("rubber", "material", trashed(4)),
        entry("unused", "prefab", trashed(5)),
        entry("tiles", "texture", trashed(6)),
        entry("sheet", "atlas", { import: { texture: "tiles" } }),
      ],
      { world },
    );
    expect(referencedTrash(view, refs)).toEqual(["k-crate", "rubber", "tiles"]);
  });

  it("skips a trashed entry whose kind the reference doesn't accept", () => {
    const { view, index: refs } = index(
      [entry("world", "level"), entry("crate", "texture", trashed(1))],
      { world },
    );
    expect(referencedTrash(view, refs)).toEqual([]);
    expect(refs.dangling().map((i) => i.got)).toEqual(["crate", "gate"]);
  });
});

describe("inUseIssue", () => {
  const entries = [
    entry("world", "level"),
    entry("cave", "level"),
    entry("crate", "prefab"),
    entry("notes", "material"),
  ];
  const crate = entries[2]!;

  it('lists path referrers with the pointer "" among the value\'s sites, by referrer id', () => {
    const { index: refs } = index(entries, {
      world,
      cave: { instances: [{ id: "c", prefab: "crate" }], entities: [] },
    });
    const issue = inUseIssue(refs, crate, { byPath: ["notes", "world"] });
    expect([issue?.code, issue?.got, issue?.entityIds]).toEqual([
      "asset-in-use",
      "crate",
      ["crate"],
    ]);
    expect(issue?.detail).toEqual({
      referrers: [
        { id: "cave", pointer: "/instances/@c/prefab" },
        { id: "notes", pointer: "" },
        { id: "world", pointer: "" },
        { id: "world", pointer: "/instances/@a/prefab" },
      ],
    });
    expect(issue?.message).toBe(
      `"crate" is referenced by "cave", "notes", "world"; repoint or remove those references first`,
    );
  });

  it("skips path referrers the caller skips, and the asset itself", () => {
    const { index: refs } = index(entries, {});
    expect(inUseIssue(refs, crate)).toBeUndefined();
    expect(inUseIssue(refs, crate, { byPath: ["crate"] })).toBeUndefined();
    expect(
      inUseIssue(refs, crate, { byPath: ["notes"], skip: (id) => id === "notes" }),
    ).toBeUndefined();
    expect(inUseIssue(refs, crate, { byPath: ["notes"] })?.detail).toEqual({
      referrers: [{ id: "notes", pointer: "" }],
    });
  });
});

describe("rewriteRefs", () => {
  const sites: RefSite[] = [
    { pointer: "/instances/@a/prefab", id: "crate", kinds: ["prefab"] },
    { pointer: "/instances/@b/prefab", id: "gate", kinds: ["prefab"] },
    { pointer: "/entities/0/material", id: "rubber", kinds: ["material"] },
  ];

  it("rewrites only the named sites and leaves other values alone", () => {
    const value: Level = {
      instances: [
        { id: "a", prefab: "crate" },
        { id: "b", prefab: "gate" },
        { id: "c", prefab: "crate" },
      ],
      entities: [{ id: "floor", material: "crate" }, { id: "wall" }],
    };
    const before = structuredClone(value);
    const next = rewriteRefs(value, sites, "crate", "box");

    expect(next).toEqual({
      instances: [
        { id: "a", prefab: "box" },
        { id: "b", prefab: "gate" },
        { id: "c", prefab: "crate" },
      ],
      entities: [{ id: "floor", material: "crate" }, { id: "wall" }],
    });
    expect(value).toEqual(before);
    expect(next.entities).toBe(value.entities);
    expect(next.instances[1]).toBe(value.instances[1]);
  });

  it("returns the value itself when nothing at the sites holds `from`", () => {
    const stale: Level = { instances: [{ id: "a", prefab: "box" }], entities: [] };
    expect(rewriteRefs(stale, sites, "crate", "box")).toBe(stale);
    expect(rewriteRefs(world, sites, "missing", "x")).toBe(world);
    expect(rewriteRefs(world, [{ pointer: "/nope/3", id: "crate", kinds: [] }], "crate", "x")).toBe(
      world,
    );
  });

  it("matches @<id> by a keyed collection's own id field when given the layout", () => {
    const layout = {
      as: "map",
      fields: { players: { as: "keyed", id: "name", item: { as: "map", rest: { as: "atomic" } } } },
    } as const;
    const value = {
      players: [
        { name: "ada", id: "x", skin: "crate" },
        { name: "x", skin: "crate" },
      ],
    };
    const site: RefSite = { pointer: "/players/@ada/skin", id: "crate", kinds: [] };
    const next = rewriteRefs(value, [site], "crate", "box", layout);
    expect(next.players).toEqual([{ name: "ada", id: "x", skin: "box" }, value.players[1]]);
    expect(namesAt(next, site, layout)).toBe(false);
    expect(namesAt(value, site, layout)).toBe(true);
    const unaware = rewriteRefs(value, [site], "crate", "box");
    expect(unaware, "without the layout, @ada matches no item's id").toBe(value);
    expect(namesAt(unaware, site, layout)).toBe(true);
  });

  it("renames a key site's key in place, joining arrays under a key already there", () => {
    const site: RefSite = { pointer: "/solid:ice", id: "ice", kinds: ["material"], in: "key" };
    const value = { name: "yard", "solid:ice": [1, 2], entities: [] };
    const next = rewriteRefs(value, [site], "ice", "snow");
    expect(Object.keys(next)).toEqual(["name", "solid:snow", "entities"]);
    expect(next).toEqual({ name: "yard", "solid:snow": [1, 2], entities: [] });
    expect(namesAt(next, site)).toBe(false);
    expect(namesAt(value, site)).toBe(true);
    const both = { "solid:snow": [0], "solid:ice": [1, 2] };
    expect(rewriteRefs(both, [site], "ice", "snow")).toEqual({ "solid:snow": [0, 1, 2] });
    const clash = { "solid:snow": 3, "solid:ice": [1] };
    expect(rewriteRefs(clash, [site], "ice", "snow")).toBe(clash);
    const nested: RefSite = { ...site, pointer: "/bulk/solid:ice" };
    expect(rewriteRefs({ bulk: value }, [nested], "ice", "snow").bulk).toEqual(next);
  });

  it("rewrites a blob entry's references and a root value", () => {
    const sheet = entry("sheet", "atlas", { import: { texture: "tiles", pad: 2 } });
    const next = rewriteRefs(
      sheet,
      [{ pointer: "/import/texture", id: "tiles", kinds: ["texture"] }],
      "tiles",
      "tileset",
    );
    expect(next.import).toEqual({ texture: "tileset", pad: 2 });
    expect(sheet.import?.texture).toBe("tiles");
    expect(rewriteRefs("a", [{ pointer: "", id: "a", kinds: [] }], "a", "b")).toBe("b");
  });
});

describe("over the engine's kinds", () => {
  const surfaces = defineGame({
    id: "surfaces",
    types: [
      defineEntityType({
        type: "pad",
        description: "A pad with a top material and a label.",
        base: "solid",
        fields: (fieldEnv) => ({
          shape: shapeField("Its shape."),
          top: materialField(fieldEnv, "Top surface."),
          label: z.string().optional().describe("A name, not a material."),
        }),
      }),
    ],
    materials: { ice: { friction: 0, restitution: 0, description: "Slippery." } },
    settings: {},
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(surfaces, {
    materials: { rubber: { description: "Bouncy.", physics: { friction: 1, restitution: 0.9 } } },
  });
  const engineKinds = createKindRegistry(null);
  const blob = { sha256: "0".repeat(64), bytes: 1 };

  const entries: AssetEntry[] = [
    entry("yard", "scene", { path: "levels/yard.json" }),
    entry("gate", "prefab", { path: "levels/prefabs/gate.json" }),
    entry("rubber", "material", { path: "materials/rubber.json" }),
    entry("walk", "input-script", { path: "levels/walk.script.json" }),
    entry("yard-checks", "checks", { path: "levels/yard.checks.json" }),
    entry("tiles", "texture", { path: "art/tiles.png", ...blob }),
    entry("sheet", "atlas", {
      path: "art/sheet.atlas.json",
      ...blob,
      import: { texture: "tiles" },
    }),
    entry("pixel", "font", {
      path: "art/pixel.fnt",
      ...blob,
      import: { pages: ["tiles", "tiles"] },
    }),
    entry("take", "recording", {
      path: "levels/take.recording.json",
      ...blob,
      meta: { scene: "yard" },
    }),
  ];
  const values: Record<AssetId, unknown> = {
    yard: {
      v: 2,
      game: "surfaces",
      name: "yard",
      bounds: [0, 0, 1000, 1000],
      instances: [
        {
          id: "g1",
          prefab: "gate",
          at: [0, 0],
          overrides: { "slope.material": "rubber", "slope.label": "rubber" },
        },
      ],
      entities: [
        { id: "floor", type: "solid", shape: ["box", 500, 900, 500, 20], material: "rubber" },
        { id: "p", type: "pad", shape: ["box", 1, 1, 1, 1], top: "ice", label: "rubber" },
      ],
      "solid:rubber": [["box", 50, 50, 10, 10]],
      "solid:ice": [["box", 70, 50, 10, 10]],
    },
    gate: {
      kind: "prefab",
      v: 2,
      game: "surfaces",
      id: "gate",
      entities: [{ id: "slope", type: "solid", shape: ["box", 0, 0, 1, 1], material: "rubber" }],
      bulk: { "solid:rubber": [["box", 5, 5, 1, 1]] },
    },
    walk: { v: 1, scene: "yard", steps: [{ wait: 60 }] },
    "yard-checks": {
      v: 1,
      checks: [
        { id: "valid", kind: "valid" },
        {
          id: "settles",
          kind: "reaches",
          result: "script-end",
          script: { v: 1, scene: "yard", steps: [] },
        },
      ],
    },
  };
  const state = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  const view = projectView(state, engineKinds);
  const refs = buildRefIndex(view, new Map(Object.entries(values)), engineKinds, {
    registry,
    project: view,
  });

  it("finds every source kind's sites", () => {
    expect(refs.referrers("gate")).toEqual([
      { id: "yard", kind: "scene", pointer: "/instances/@g1/prefab" },
    ]);
    expect(refs.referrers("rubber")).toEqual([
      { id: "gate", kind: "prefab", pointer: "/bulk/solid:rubber" },
      { id: "gate", kind: "prefab", pointer: "/entities/@slope/material" },
      { id: "yard", kind: "scene", pointer: "/entities/@floor/material" },
      { id: "yard", kind: "scene", pointer: "/instances/@g1/overrides/slope.material" },
      { id: "yard", kind: "scene", pointer: "/solid:rubber" },
    ]);
    expect(refs.targets("yard").filter((s) => s.in === "key")).toEqual([
      { pointer: "/solid:rubber", id: "rubber", kinds: ["material"], in: "key" },
    ]);
    expect(refs.referrers("tiles")).toEqual([
      { id: "pixel", kind: "font", pointer: "/import/pages/0" },
      { id: "pixel", kind: "font", pointer: "/import/pages/1" },
      { id: "sheet", kind: "atlas", pointer: "/import/texture" },
    ]);
    expect(refs.referrers("yard")).toEqual([
      { id: "take", kind: "recording", pointer: "/meta/scene" },
      { id: "walk", kind: "input-script", pointer: "/scene" },
      { id: "yard-checks", kind: "checks", pointer: "/checks/@settles/script/scene" },
    ]);
    expect(refs.referrers("ice"), "a game's code material isn't an asset").toEqual([]);
    expect(refs.targets("rubber")).toEqual([]);
    expect(refs.dangling()).toEqual([]);
  });

  it("counts a variant's own material overrides", () => {
    const variant = {
      kind: "prefab",
      v: 3,
      game: "surfaces",
      id: "gate",
      base: "post",
      entities: [],
      overrides: { "slope.material": "rubber", "slope.label": "rubber" },
    };
    const index = buildRefIndex(view, new Map([["gate", variant]]), engineKinds, {
      registry,
      project: view,
    });
    expect(index.referrers("rubber")).toEqual([
      { id: "gate", kind: "prefab", pointer: "/overrides/slope.material" },
    ]);
    expect(rewriteRefs(variant, index.targets("gate"), "rubber", "bouncy").overrides).toEqual({
      "slope.material": "bouncy",
      "slope.label": "rubber",
    });
  });

  it("rewrites each kind's sites and leaves every other value alone", () => {
    const yard = values.yard as Record<string, any>;
    const scene = rewriteRefs(yard, refs.targets("yard"), "rubber", "bouncy");
    expect(scene.entities).toEqual([{ ...yard.entities[0], material: "bouncy" }, yard.entities[1]]);
    expect(scene.entities[1]).toBe(yard.entities[1]);
    expect(scene.instances[0].overrides).toEqual({
      "slope.material": "bouncy",
      "slope.label": "rubber",
    });
    expect(scene["solid:bouncy"]).toBe(yard["solid:rubber"]);
    expect(scene["solid:rubber"]).toBeUndefined();
    expect(scene["solid:ice"]).toBe(yard["solid:ice"]);
    const gate = values.gate as Record<string, any>;
    expect(rewriteRefs(gate, refs.targets("gate"), "rubber", "bouncy").bulk).toEqual({
      "solid:bouncy": gate.bulk["solid:rubber"],
    });
    expect(rewriteRefs(yard, refs.targets("yard"), "gate", "door").instances).toEqual([
      { ...yard.instances[0], prefab: "door" },
    ]);

    const checks = values["yard-checks"] as Record<string, any>;
    const moved = rewriteRefs(checks, refs.targets("yard-checks"), "yard", "court");
    expect(moved.checks[1].script).toEqual({ ...checks.checks[1].script, scene: "court" });
    expect(moved.checks[0]).toBe(checks.checks[0]);

    const pixel = view.byId.get("pixel")!;
    expect(rewriteRefs(pixel, refs.targets("pixel"), "tiles", "tileset").import).toEqual({
      pages: ["tileset", "tileset"],
    });
    const take = view.byId.get("take")!;
    expect(rewriteRefs(take, refs.targets("take"), "yard", "court").meta).toEqual({
      scene: "court",
    });
  });
});

describe("schemaRefSites", () => {
  const env: FieldEnv = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };
  const tex = assetField(env, "texture", "A picture.");

  it("follows objects, arrays, tuples, records, unions and wrappers alongside the value", () => {
    const shape = {
      skin: tex.optional(),
      frames: z.array(tex).optional(),
      pair: z.tuple([tex, z.number()]).optional(),
      byState: z.record(z.string(), tex.nullable()).optional(),
      look: z
        .object({ icon: tex.default("dot"), size: z.number() })
        .optional()
        .describe("A look."),
      either: z.union([z.number(), z.object({ sound: assetField(env, "audio", "A cue.") })]),
      label: z.string().optional(),
    };
    const sites = schemaRefSites(
      shape,
      {
        skin: "a",
        frames: ["b", "c"],
        pair: ["d", 3],
        byState: { idle: "e", off: null },
        look: { icon: "f", size: 2 },
        either: { sound: "boom" },
        label: "not-an-asset",
        extra: "ignored",
      },
      "/entities/@x",
    );
    expect(sites).toEqual([
      { pointer: "/entities/@x/skin", id: "a", kinds: ["texture"] },
      { pointer: "/entities/@x/frames/0", id: "b", kinds: ["texture"] },
      { pointer: "/entities/@x/frames/1", id: "c", kinds: ["texture"] },
      { pointer: "/entities/@x/pair/0", id: "d", kinds: ["texture"] },
      { pointer: "/entities/@x/byState/idle", id: "e", kinds: ["texture"] },
      { pointer: "/entities/@x/look/icon", id: "f", kinds: ["texture"] },
      { pointer: "/entities/@x/either/sound", id: "boom", kinds: ["audio"] },
    ]);
  });

  it("finds nothing in a value that isn't an object, or where the value has no leaf", () => {
    expect(schemaRefSites({ skin: tex }, "skin", "")).toEqual([]);
    expect(schemaRefSites({ skin: tex }, { skin: 3 }, "")).toEqual([]);
    expect(schemaRefSites({ frames: z.array(tex) }, { frames: "a" }, "")).toEqual([]);
    expect(schemaRefSites({ skin: tex.optional() }, {}, "")).toEqual([]);
  });

  it("escapes keys into the pointer", () => {
    expect(schemaRefSites({ "a/b": tex }, { "a/b": "x" }, "/s")).toEqual([
      { pointer: "/s/a~1b", id: "x", kinds: ["texture"] },
    ]);
  });
});

describe("asset fields over the engine's kinds", () => {
  const fieldEnv: FieldEnv = {
    materials: [],
    materialDefs: new Map(),
    types: [],
    assets: () => [],
  };
  const art = defineGame({
    id: "art",
    types: [
      defineEntityType({
        type: "sign",
        description: "A sign with a picture.",
        base: "marker",
        fields: (env) => ({
          at: pointField("Where it stands."),
          skin: assetField(env, "texture", "Its picture.").optional(),
        }),
      }),
    ],
    settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
    tables: {
      card: {
        description: "Cards.",
        row: { art: assetField(fieldEnv, "texture", "Its art.").optional() },
      },
    },
    projectSettings: { icon: assetField(fieldEnv, "texture", "The game's icon.").optional() },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(art);
  const engineKinds = createKindRegistry(art);
  const blob = { sha256: "0".repeat(64), bytes: 1 };
  const entries: AssetEntry[] = [
    entry("yard", "scene", { path: "levels/yard.json" }),
    entry("post", "prefab", { path: "levels/prefabs/post.json" }),
    entry("big-post", "prefab", { path: "levels/prefabs/big-post.json" }),
    entry("deck", "data-table", { path: "data/deck.json" }),
    entry("settings", "game-settings", { path: "settings.json" }),
    entry("tiles", "texture", { path: "art/tiles.png", ...blob }),
    entry("boom", "audio", { path: "sfx/boom.wav", ...blob }),
  ];
  const values: Record<AssetId, unknown> = {
    yard: {
      v: 2,
      game: "art",
      name: "yard",
      bounds: [0, 0, 100, 100],
      settings: { backdrop: "tiles" },
      assets: ["boom", "tiles"],
      instances: [
        { id: "p1", prefab: "big-post", at: [0, 0], overrides: { "board.skin": "tiles" } },
      ],
      entities: [{ id: "s1", type: "sign", at: [1, 1], skin: "tiles" }],
    },
    post: {
      kind: "prefab",
      v: 2,
      game: "art",
      id: "post",
      entities: [{ id: "board", type: "sign", at: [0, 0], skin: "tiles" }],
    },
    "big-post": {
      kind: "prefab",
      v: 2,
      game: "art",
      id: "big-post",
      base: "post",
      instances: [{ id: "inner", prefab: "post", at: [0, 0] }],
      entities: [],
    },
    deck: { kind: "data-table", v: 1, table: "card", rows: [{ id: "fire", art: "tiles" }] },
    settings: { kind: "game-settings", v: 1, engine: {}, game: { icon: "tiles" } },
  };
  const state = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  const view = projectView(state, engineKinds);
  const refs = buildRefIndex(view, new Map(Object.entries(values)), engineKinds, {
    registry,
    project: view,
  });

  it("finds each new source's sites", () => {
    expect(refs.referrers("tiles")).toEqual([
      { id: "deck", kind: "data-table", pointer: "/rows/@fire/art" },
      { id: "post", kind: "prefab", pointer: "/entities/@board/skin" },
      { id: "settings", kind: "game-settings", pointer: "/game/icon" },
      { id: "yard", kind: "scene", pointer: "/assets/1" },
      { id: "yard", kind: "scene", pointer: "/entities/@s1/skin" },
      { id: "yard", kind: "scene", pointer: "/instances/@p1/overrides/board.skin" },
      { id: "yard", kind: "scene", pointer: "/settings/backdrop" },
    ]);
    expect(refs.referrers("boom")).toEqual([{ id: "yard", kind: "scene", pointer: "/assets/0" }]);
    expect(refs.referrers("post"), "a variant base and a nested instance count").toEqual([
      { id: "big-post", kind: "prefab", pointer: "/base" },
      { id: "big-post", kind: "prefab", pointer: "/instances/@inner/prefab" },
    ]);
    expect(refs.dangling()).toEqual([]);
  });

  it("counts a variant's own overrides, and a rename rewrites them", () => {
    const red = {
      kind: "prefab",
      v: 3,
      game: "art",
      id: "red-post",
      base: "post",
      entities: [],
      overrides: { "board.skin": "tiles", "board.at": [1, 1] },
    };
    const withRed = projectView(
      {
        ...state,
        assets: Object.fromEntries(
          [...entries, entry("red-post", "prefab", { path: "levels/prefabs/red-post.json" })].map(
            (e) => [e.key, e],
          ),
        ),
      },
      engineKinds,
    );
    const index = buildRefIndex(
      withRed,
      new Map([...Object.entries(values), ["red-post", red]]),
      engineKinds,
      { registry, project: withRed },
    );
    expect(index.referrers("tiles")).toContainEqual({
      id: "red-post",
      kind: "prefab",
      pointer: "/overrides/board.skin",
    });
    const next = rewriteRefs(red, index.targets("red-post"), "tiles", "tileset");
    expect(next.overrides).toEqual({ "board.skin": "tileset", "board.at": [1, 1] });
    expect(next.base).toBe("post");
  });

  it("reports a dangling or wrong-kind asset field as asset-missing", () => {
    const binned = entries.map((e) => (e.id === "tiles" ? { ...e, ...trashed(4) } : e));
    const gone = projectView(
      { ...state, assets: Object.fromEntries(binned.map((e) => [e.key, e])) },
      engineKinds,
    );
    const index = buildRefIndex(gone, new Map(Object.entries(values)), engineKinds, {
      registry,
      project: gone,
    });
    expect(new Set(index.dangling().map((i) => i.code))).toEqual(new Set(["asset-missing"]));
    expect(index.dangling().map((i) => i.path)).toContain("/rows/@fire/art");

    const misnamed = { ...(values.deck as object), rows: [{ id: "fire", art: "boom" }] };
    const wrong = buildRefIndex(view, new Map([["deck", misnamed]]), engineKinds, {
      registry,
      project: view,
    });
    expect(wrong.dangling().map((i) => [i.code, i.got, i.message])).toEqual([
      [
        "asset-missing",
        "boom",
        `"deck" names texture "boom" at /rows/@fire/art, but "boom" is a audio.`,
      ],
    ]);
  });

  it("rewrites the new sites", () => {
    const yard = values.yard as Record<string, any>;
    const next = rewriteRefs(yard, refs.targets("yard"), "tiles", "tileset");
    expect(next.settings).toEqual({ backdrop: "tileset" });
    expect(next.assets).toEqual(["boom", "tileset"]);
    expect(next.entities[0].skin).toBe("tileset");
    expect(next.instances[0].overrides).toEqual({ "board.skin": "tileset" });
    const deck = values.deck as Record<string, any>;
    const layout = engineKinds.get("data-table");
    expect(
      rewriteRefs(
        deck,
        refs.targets("deck"),
        "tiles",
        "tileset",
        layout?.storage === "doc" && layout.layout !== "custom" ? layout.layout : undefined,
      ).rows,
    ).toEqual([{ id: "fire", art: "tileset" }]);
  });
});

describe("a behavior's asset field", () => {
  const fieldEnv: FieldEnv = {
    materials: [],
    materialDefs: new Map(),
    types: [],
    assets: () => [],
  };
  const skin = defineBehavior({
    name: "paint/skin",
    description: "A picture drawn over the entity.",
    fields: (env) => ({ texture: assetField(env, "texture", "The picture.") }),
  });
  const paint = defineGame({
    id: "paint",
    types: [
      defineEntityType({
        type: "sign",
        description: "A sign.",
        base: "marker",
        fields: { at: pointField("Where it stands.") },
      }),
    ],
    behaviors: [skin],
    settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
    tables: {
      card: {
        description: "Cards.",
        row: { art: assetField(fieldEnv, "texture", "Its art.").optional() },
      },
    },
    projectSettings: { icon: assetField(fieldEnv, "texture", "The game's icon.").optional() },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(paint);
  const engineKinds = createKindRegistry(paint);
  const blob = { sha256: "0".repeat(64), bytes: 1 };
  const entries: AssetEntry[] = [
    entry("yard", "scene", { path: "levels/yard.json" }),
    entry("deck", "data-table", { path: "data/deck.json" }),
    entry("settings", "game-settings", { path: "settings.json" }),
    entry("tiles", "texture", { path: "art/tiles.png", ...blob }),
  ];
  const values: Record<AssetId, unknown> = {
    yard: {
      v: 2,
      game: "paint",
      name: "yard",
      bounds: [0, 0, 100, 100],
      settings: { backdrop: "tiles" },
      assets: ["tiles"],
      entities: [
        { id: "s1", type: "sign", at: [1, 1], behaviors: { "paint/skin": { texture: "tiles" } } },
      ],
    },
    deck: { kind: "data-table", v: 1, table: "card", rows: [{ id: "fire", art: "tiles" }] },
    settings: { kind: "game-settings", v: 1, engine: {}, game: { icon: "tiles" } },
  };
  const state = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  const view = projectView(state, engineKinds);

  it("is a referrer site under the block's escaped pointer", () => {
    const refs = buildRefIndex(view, new Map(Object.entries(values)), engineKinds, {
      registry,
      project: view,
    });
    expect(refs.referrers("tiles")).toContainEqual({
      id: "yard",
      kind: "scene",
      pointer: "/entities/@s1/behaviors/paint~1skin/texture",
    });
    expect(refs.dangling()).toEqual([]);
  });

  it("follows a changeAssetId with the settings field, header id and table row in one batch", () => {
    const docs = new Map(Object.entries(values).map(([k, v]) => [k, structuredClone(v)]));
    const r = checkProjectBatch(
      state,
      docs,
      { v: 1, ops: [{ op: "changeAssetId", id: "tiles", to: "tileset" }] },
      { registry, kinds: engineKinds, now: 1, by: "test", newKey: sequentialKeys() },
    );
    if (!r.ok) throw new Error(r.issue.message);
    const yard = r.values.get("yard") as Record<string, any>;
    expect(yard.entities[0].behaviors).toEqual({ "paint/skin": { texture: "tileset" } });
    expect(yard.settings).toEqual({ backdrop: "tileset" });
    expect(yard.assets).toEqual(["tileset"]);
    expect((r.values.get("deck") as Record<string, any>).rows).toEqual([
      { id: "fire", art: "tileset" },
    ]);
    expect((r.values.get("settings") as Record<string, any>).game).toEqual({ icon: "tileset" });
    expect(r.scenes.get("yard")?.ops).toContainEqual({
      op: "update",
      ref: "s1",
      set: { "behaviors.paint/skin.texture": "tileset" },
    });
    expect(r.issues).toEqual([]);
  });
});
