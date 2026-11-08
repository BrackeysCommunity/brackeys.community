import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { toJsonSchema } from "../../scene/json-schema";
import { stableJson } from "../canonical";
import { sha256 } from "../hash";
import {
  createKindRegistry,
  defineAssetKind,
  isSkippedAssetPath,
  validateAssetDoc,
  type AssetKindDef,
  type DocKindDef,
  type DocLayout,
  type KindEnv,
} from "../kinds";

const env: KindEnv = { registry: createRegistry(), project: null };

function docKind(
  kind: string,
  match: DocKindDef["match"],
  layout: DocLayout | "custom" = { as: "map", rest: { as: "atomic" } },
  schema: z.ZodType = z.looseObject({}),
): DocKindDef {
  return defineAssetKind({
    kind,
    title: kind,
    description: `${kind} files`,
    match,
    storage: "doc",
    version: 1,
    schemaId: `urn:jams-engine:${kind.replace("/", ":")}:v1`,
    schema: () => schema,
    layout,
    empty: () => ({}),
  });
}

const sceneKind = docKind(
  "scene",
  {
    test: (json) =>
      json !== null &&
      typeof json === "object" &&
      !("kind" in json) &&
      "v" in json &&
      ("entities" in json || "bounds" in json),
  },
  "custom",
);
const prefabKind = docKind("prefab", { jsonKind: "prefab" }, "custom");
const checksKind = docKind("checks", { suffixes: [".checks.json"] });
const atlasKind = defineAssetKind({
  kind: "atlas",
  title: "Atlas",
  description: "Sprite atlases",
  match: { suffixes: [".atlas.json"] },
  storage: "blob",
  contentTypes: ["application/json"],
  maxBytes: 2 * 1024 * 1024,
  settings: z.object({ texture: z.string().optional() }),
  meta: z.object({ frames: z.number() }),
  inspect: () => ({ ok: true, meta: { frames: 0 } }),
});
const textureKind = defineAssetKind({
  kind: "texture",
  title: "Texture",
  description: "Images",
  match: { suffixes: [".png", ".jpg"] },
  storage: "blob",
  contentTypes: ["image/png", "image/jpeg"],
  maxBytes: 8 * 1024 * 1024,
  settings: z.object({ filter: z.enum(["nearest", "linear"]).optional() }),
  meta: z.object({ width: z.number(), height: z.number() }),
  inspect: () => ({ ok: true, meta: { width: 1, height: 1 } }),
});
const codeKind = defineAssetKind({
  kind: "code",
  title: "Code",
  description: "Game code",
  match: { suffixes: [".ts"] },
  storage: "code",
});
const ENGINE: readonly AssetKindDef[] = [
  sceneKind,
  prefabKind,
  checksKind,
  atlasKind,
  textureKind,
  codeKind,
];

const game = (id: string, assetKinds: readonly AssetKindDef[]) =>
  ({ id, assetKinds }) as unknown as GameDefinition;

describe("createKindRegistry", () => {
  it("lists engine kinds first, then the game's, and looks them up by name", () => {
    const deck = docKind("cards/deck", { suffixes: [".deck.json"] });
    const kinds = createKindRegistry(game("cards", [deck]), ENGINE);
    expect(kinds.list().map((k) => k.kind)).toEqual([...ENGINE.map((k) => k.kind), "cards/deck"]);
    expect(kinds.get("cards/deck")).toBe(deck);
    expect(kinds.get("nope")).toBeUndefined();
  });

  it("is empty with no game and no base", () => {
    expect(createKindRegistry(null, []).list()).toEqual([]);
    expect(createKindRegistry(null, []).detect("a.json", { v: 1, entities: [] })).toBeNull();
    expect(createKindRegistry().detect("a.json", { v: 1, entities: [] })?.kind).toBe("scene");
  });

  it("refuses a duplicate name", () => {
    expect(() => createKindRegistry(null, [checksKind, checksKind])).toThrow(/registered twice/);
    const twin = docKind("cards/deck", { jsonKind: "a" });
    const again = docKind("cards/deck", { jsonKind: "b" });
    expect(() => createKindRegistry(game("cards", [twin, again]), ENGINE)).toThrow(
      /registered twice/,
    );
  });

  it("refuses a game kind without its <gameId>/ prefix", () => {
    for (const name of ["deck", "other/deck", "cards/", "cards/Deck", "cards/a/b"])
      expect(
        () => createKindRegistry(game("cards", [docKind(name, { jsonKind: "x" })]), ENGINE),
        name,
      ).toThrow(/must be named "cards\/<name>"/);
  });

  it("refuses a game kind shadowing an engine kind's name", () => {
    expect(() => createKindRegistry(game("cards", [checksKind]), ENGINE)).toThrow(/must be named/);
  });

  it("refuses a game kind with a custom layout", () => {
    const custom = docKind("cards/deck", { jsonKind: "deck" }, "custom");
    expect(() => createKindRegistry(game("cards", [custom]), ENGINE)).toThrow(
      /can't use layout "custom"/,
    );
  });

  it("refuses an engine kind whose name isn't an id", () => {
    expect(() => createKindRegistry(null, [docKind("Scene", {})])).toThrow(/doesn't match/);
  });

  it("refuses a declarative layout whose root isn't a map", () => {
    const bad = docKind("cards/deck", { jsonKind: "deck" }, { as: "list", item: { as: "atomic" } });
    expect(() => createKindRegistry(game("cards", [bad]), ENGINE)).toThrow(/"map" root/);
  });

  it("refuses a suffix or jsonKind two kinds claim", () => {
    const png = docKind("cards/sheet", { suffixes: [".PNG"] });
    expect(() => createKindRegistry(game("cards", [png]), ENGINE)).toThrow(/both claim ".PNG"/);
    const prefab = docKind("cards/prefab", { jsonKind: "prefab" });
    expect(() => createKindRegistry(game("cards", [prefab]), ENGINE)).toThrow(
      /both claim jsonKind "prefab"/,
    );
  });
});

describe("detect", () => {
  const deck = docKind("cards/deck", { jsonKind: "deck" });
  const sleeve = docKind("cards/sleeve", { suffixes: [".sleeve.json"] });
  const kinds = createKindRegistry(game("cards", [deck, sleeve]), ENGINE);
  const name = (path: string, json?: unknown, sidecar?: string) =>
    kinds.detect(path, json, sidecar)?.kind ?? null;
  const scene = { v: 2, bounds: [0, 0, 10, 10], entities: [] };

  it("takes the sidecar's kind first", () => {
    expect(name("art/hero.json", { meta: { app: "aseprite" } }, "atlas")).toBe("atlas");
    expect(name("levels/a.json", scene, "cards/deck")).toBe("cards/deck");
    expect(name("art/hero.png", undefined, "atlas")).toBe("atlas");
  });

  it("gives null for a sidecar kind the registry doesn't have", () => {
    expect(name("levels/a.json", scene, "cards/missing")).toBeNull();
  });

  it("takes the longest suffix next, ignoring case", () => {
    expect(name("art/hero.atlas.json", { kind: "prefab" })).toBe("atlas");
    expect(name("levels/a.checks.json", scene)).toBe("checks");
    expect(name("art/HERO.PNG")).toBe("texture");
    expect(name("art/hero.jpg")).toBe("texture");
    expect(name("decks/red.sleeve.json", { kind: "deck" })).toBe("cards/sleeve");
  });

  it("then a .json file's top-level kind", () => {
    expect(name("prefabs/post.json", { kind: "prefab", id: "post" })).toBe("prefab");
    expect(name("decks/red.json", { kind: "deck", v: 1, entities: [] })).toBe("cards/deck");
    expect(name("decks/red.txt", { kind: "deck" })).toBeNull();
  });

  it("then a kind's test", () => {
    expect(name("levels/a.json", scene)).toBe("scene");
    expect(name("levels/b.json", { v: 2, entities: [] })).toBe("scene");
    expect(name("levels/c.json", { kind: "unknown", v: 2, entities: [] })).toBeNull();
    expect(name("levels/d.json", { v: 2 })).toBeNull();
    expect(name("levels/e.json")).toBeNull();
    expect(name("levels/f.json", [1, 2])).toBeNull();
  });

  it("gives null for anything else", () => {
    expect(name("notes.md")).toBeNull();
    expect(name("data/other.json", { hello: 1 })).toBeNull();
  });

  it("always skips schemas, sidecars, the project file, tests and build output", () => {
    const skipped = [
      "scene.schema.json",
      "art/hero.png.asset.json",
      "jams.project.json",
      "levels/__tests__/a.json",
      "node_modules/x/a.png",
      "dist/a.png",
      "a/dist/b.checks.json",
    ];
    for (const path of skipped) {
      expect(isSkippedAssetPath(path), path).toBe(true);
      expect(name(path, scene, "atlas"), path).toBeNull();
    }
    expect(isSkippedAssetPath("levels/distant.json")).toBe(false);
    expect(isSkippedAssetPath("levels/my.jams.project.json.bak")).toBe(false);
    expect(name("sub/jams.project.json", scene)).toBeNull();
  });
});

describe("schemaHashes", () => {
  it("hashes each doc and blob kind's JSON Schema with stableJson and skips code", async () => {
    const deck = docKind(
      "cards/deck",
      { jsonKind: "deck" },
      { as: "map" },
      z.object({ cards: z.array(z.string()) }),
    );
    const kinds = createKindRegistry(game("cards", [deck]), ENGINE);
    const hashes = await kinds.schemaHashes(env);
    expect(Object.keys(hashes)).toEqual([
      "scene",
      "prefab",
      "checks",
      "atlas",
      "texture",
      "cards/deck",
    ]);
    expect(hashes["cards/deck"]).toBe(
      await sha256(stableJson(toJsonSchema(z.object({ cards: z.array(z.string()) })))),
    );
    expect(hashes.texture).toBe(
      await sha256(
        stableJson({
          settings: toJsonSchema(textureKind.settings),
          meta: toJsonSchema(textureKind.meta),
        }),
      ),
    );
    expect(await kinds.schemaHashes(env)).toEqual(hashes);
  });

  it("changes when a kind's schema changes", async () => {
    const v1 = docKind(
      "cards/deck",
      { jsonKind: "deck" },
      { as: "map" },
      z.object({ a: z.number() }),
    );
    const v2 = docKind(
      "cards/deck",
      { jsonKind: "deck" },
      { as: "map" },
      z.object({ a: z.string() }),
    );
    const a = await createKindRegistry(game("cards", [v1])).schemaHashes(env);
    const b = await createKindRegistry(game("cards", [v2])).schemaHashes(env);
    expect(a["cards/deck"]).not.toBe(b["cards/deck"]);
  });

  it("passes the env to a schema that depends on it", async () => {
    const seen: KindEnv[] = [];
    const deck = defineAssetKind({
      ...docKind("cards/deck", { jsonKind: "deck" }),
      schema: (e: KindEnv) => {
        seen.push(e);
        return z.object({ registry: z.literal(e.registry.id) });
      },
    });
    await createKindRegistry(game("cards", [deck])).schemaHashes(env);
    expect(seen).toEqual([env]);
  });
});

describe("validateAssetDoc", () => {
  const table = docKind(
    "cards/table",
    { jsonKind: "table" },
    {
      as: "map",
      fields: {
        table: { as: "atomic" },
        rows: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
        groups: {
          as: "list",
          item: { as: "map", fields: { cards: { as: "keyed", id: "name", item: { as: "map" } } } },
        },
      },
    },
    z
      .object({
        table: z.string(),
        rows: z.array(z.object({ id: z.string(), cost: z.number() }).strict()),
        groups: z.array(z.object({ cards: z.array(z.object({ name: z.string() })) })).optional(),
      })
      .strict(),
  );

  it("passes a valid value", () => {
    expect(validateAssetDoc(table, { table: "card", rows: [{ id: "a", cost: 1 }] }, env)).toEqual(
      [],
    );
  });

  it("reports schema issues with pointers, and unknown keys as unknown-key", () => {
    const issues = validateAssetDoc(
      table,
      { table: 3, rows: [{ id: "a", cost: "x", extra: 1 }], stray: true },
      env,
    );
    expect(issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ["schema", "/table"],
        ["schema", "/rows/0/cost"],
        ["unknown-key", "/rows/0/extra"],
        ["unknown-key", "/stray"],
      ]),
    );
    expect(issues.find((i) => i.path === "/table")).toMatchObject({
      severity: "error",
      expected: "string",
    });
  });

  it("reports dup-id for each repeat in a keyed collection, nested ones included", () => {
    const issues = validateAssetDoc(
      table,
      {
        table: "card",
        rows: [
          { id: "a", cost: 1 },
          { id: "b", cost: 1 },
          { id: "a", cost: 2 },
          { id: "a", cost: 3 },
        ],
        groups: [{ cards: [{ name: "x" }, { name: "x" }] }, { cards: [{ name: "x" }] }],
      },
      env,
    );
    expect(issues.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["dup-id", "/rows/2/id", ["a"]],
      ["dup-id", "/rows/3/id", ["a"]],
      ["dup-id", "/groups/0/cards/1/name", ["x"]],
    ]);
  });

  it("reports dup-id even when the schema fails, and runs validate only when it passes", () => {
    const calls: unknown[] = [];
    const checked: DocKindDef = {
      ...table,
      validate: (value) => {
        calls.push(value);
        return [];
      },
    };
    const issues = validateAssetDoc(
      checked,
      {
        table: 1,
        rows: [
          { id: "a", cost: 1 },
          { id: "a", cost: 1 },
        ],
      },
      env,
    );
    expect(issues.map((i) => i.code).sort()).toEqual(["dup-id", "schema"]);
    expect(calls).toEqual([]);
    validateAssetDoc(checked, { table: "t", rows: [] }, env);
    expect(calls).toEqual([{ table: "t", rows: [] }]);
  });

  it("appends the kind's own issues", () => {
    const own: DocKindDef = {
      ...table,
      validate: () => [
        {
          severity: "warn",
          code: "schema",
          message: "custom",
          entityIds: [],
        },
      ],
    };
    expect(validateAssetDoc(own, { table: "t", rows: [] }, env).map((i) => i.message)).toEqual([
      "custom",
    ]);
  });

  it("skips the dup-id walk for a custom layout", () => {
    const custom = docKind("prefab", { jsonKind: "prefab" }, "custom");
    expect(validateAssetDoc(custom, { entities: [{ id: "a" }, { id: "a" }] }, env)).toEqual([]);
  });
});
