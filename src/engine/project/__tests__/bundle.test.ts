import { describe, expect, it } from "vite-plus/test";

import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineGame } from "../../game/define";
import { assetField, pointField } from "../../game/fields";
import type { FieldEnv } from "../../game/types";
import { expandScene } from "../../scene/expand";
import { parseScene } from "../../scene/parse";
import { parsePrefab, prefabLibrary } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { projectBundle, sceneBundle } from "../bundle";
import { createKindRegistry } from "../kinds";
import type { AssetEntry, ProjectState } from "../types";
import { projectView } from "../view";

const fieldEnv: FieldEnv = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };

const look = defineBehavior({
  name: "art/look",
  description: "How it looks.",
  fields: { skin: assetField(fieldEnv, ["texture", "atlas"], "Its picture.").optional() },
});

const art = defineGame({
  id: "art",
  behaviors: [look],
  types: [
    {
      type: "statue",
      description: "A statue whose look only its type's default names.",
      base: "marker",
      fields: (env) => ({
        at: pointField("Where it stands."),
        icon: assetField(env, "texture", "Its icon.").optional(),
      }),
      behaviors: { required: { [look.name]: { skin: "statue-art" } } },
    },
  ],
  settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
  projectSettings: {
    icon: assetField(fieldEnv, "texture", "The game's icon.").optional(),
    splash: assetField(fieldEnv, "texture", "The splash.").default("splash-art"),
  },
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(art);
const kinds = createKindRegistry(art);

let n = 0;
const hash = () => (n++).toString(16).padStart(64, "0");
const created = { at: 0, by: "test" };
const texture = (id: string, bytes = 10): AssetEntry => ({
  key: id,
  id,
  kind: "texture",
  path: `art/${id}.png`,
  sha256: hash(),
  bytes,
  meta: { format: "png", width: 8, height: 8 },
  created,
});
const blob = (id: string, kind: string, path: string, imports: Record<string, unknown>) =>
  ({
    key: id,
    id,
    kind,
    path,
    sha256: hash(),
    bytes: 5,
    import: imports,
    created,
  }) satisfies AssetEntry;
const doc = (id: string, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created,
});

const entries: AssetEntry[] = [
  texture("statue-art", 100),
  texture("icon-art", 20),
  texture("sky-art", 30),
  texture("nested-art", 40),
  texture("base-art", 50),
  texture("crates-art", 60),
  texture("glyph-page", 70),
  texture("splash-art", 80),
  texture("unused-art", 999),
  blob("crates", "atlas", "art/crates.json", { texture: "crates-art" }),
  blob("glyphs", "font", "art/glyphs.fnt", { pages: ["glyph-page"] }),
  blob("broken", "atlas", "art/broken.json", { texture: "crate-art" }),
  blob("boom", "audio", "sfx/boom.wav", {}),
  { ...texture("hollow"), sha256: undefined, bytes: undefined },
  { ...texture("trashed-art"), deleted: { at: 1, by: "test" } },
  doc("yard", "scene", "yard.json"),
  doc("outer", "prefab", "prefabs/outer.json"),
  doc("inner", "prefab", "prefabs/inner.json"),
  doc("fancy", "prefab", "prefabs/fancy.json"),
  doc("plain", "prefab", "prefabs/plain.json"),
  doc("game-settings", "game-settings", "game-settings.json"),
];
const state = (list: AssetEntry[]): ProjectState => ({
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: Object.fromEntries(list.map((e) => [e.key, e])),
  history: {},
  code: {},
  build: {},
});
const view = projectView(state(entries), kinds);
const bytesOf = (id: string) => entries.find((e) => e.id === id)!.bytes!;

function prefab(raw: Record<string, unknown>): Prefab {
  const parsed = parsePrefab({ kind: "prefab", v: 4, game: "art", entities: [], ...raw }, registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.prefab;
}
const prefabs = prefabLibrary([
  prefab({ id: "outer", instances: [{ id: "in-1", prefab: "inner", at: [0, 0] }] }),
  prefab({ id: "inner", assets: ["nested-art"] }),
  prefab({ id: "plain", assets: ["base-art"] }),
  prefab({ id: "fancy", base: "plain" }),
]);

function scene(raw: Record<string, unknown>): SceneDefinition {
  const parsed = parseScene(
    { v: 4, game: "art", name: "yard", bounds: [0, 0, 1000, 1000], ...raw },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.def;
}
const bundleOf = (def: SceneDefinition, on = view) =>
  sceneBundle(expandScene(def, registry, { prefabs }), def, prefabs, on, kinds, registry);
const ids = (r: ReturnType<typeof bundleOf>) => r.bundle.entries.map((e) => e.id);

describe("sceneBundle", () => {
  it("has an id only a type's required default names", () => {
    const r = bundleOf(scene({ entities: [{ id: "s", type: "statue", at: [0, 0] }] }));
    expect(r.issues).toEqual([]);
    expect(r.bundle).toEqual({
      name: "yard",
      entries: [
        {
          id: "statue-art",
          kind: "texture",
          sha256: entries[0]!.sha256,
          bytes: 100,
        },
      ],
      bytes: 100,
    });
  });

  it("takes entities' own fields and behavior blocks, settings, and the scene's header", () => {
    const r = bundleOf(
      scene({
        settings: { backdrop: "sky-art" },
        assets: ["glyphs", "boom", "yard"],
        entities: [
          {
            id: "s",
            type: "statue",
            at: [0, 0],
            icon: "icon-art",
            behaviors: { [look.name]: { skin: "crates" } },
          },
        ],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(ids(r)).toEqual(["crates-art", "glyph-page", "icon-art", "sky-art"]);
  });

  it("follows an atlas to its texture and a font to its pages, not fetching either file", () => {
    const r = bundleOf(scene({ assets: ["crates", "glyphs"] }));
    expect(ids(r)).toEqual(["crates-art", "glyph-page"]);
    expect(r.bundle.entries.map((e) => e.kind)).toEqual(["texture", "texture"]);
  });

  it("takes the header of every prefab the scene reaches, nested and variant bases too", () => {
    const r = bundleOf(
      scene({
        instances: [
          { id: "o", prefab: "outer", at: [0, 0] },
          { id: "f", prefab: "fancy", at: [100, 0] },
        ],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(ids(r)).toEqual(["base-art", "nested-art"]);
  });

  it("is sorted by id, names each once and totals the bytes", () => {
    const r = bundleOf(
      scene({
        assets: ["sky-art", "crates-art", "crates", "sky-art"],
        entities: [
          { id: "a", type: "statue", at: [0, 0], icon: "sky-art" },
          { id: "b", type: "statue", at: [10, 0], icon: "sky-art" },
        ],
      }),
    );
    expect(ids(r)).toEqual(["crates-art", "sky-art", "statue-art"]);
    expect(r.bundle.bytes).toBe(bytesOf("crates-art") + bytesOf("sky-art") + bytesOf("statue-art"));
  });

  it("reports a dangling id as asset-missing with the closest live id", () => {
    const r = bundleOf(
      scene({
        settings: { backdrop: "sky-ar" },
        assets: ["trashed-art", "hollow", "broken"],
        entities: [{ id: "s", type: "statue", at: [0, 0], icon: "boom" }],
      }),
    );
    expect(ids(r)).toEqual(["statue-art"]);
    expect(r.issues.map((i) => [i.code, i.path, i.got, i.entityIds])).toEqual([
      ["asset-missing", "/entities/@s/icon", "boom", ["s"]],
      ["asset-missing", "/settings/backdrop", "sky-ar", []],
      ["asset-missing", "/assets/0", "trashed-art", []],
      ["asset-missing", "/assets/1", "hollow", []],
      ["asset-missing", "/import/texture", "crate-art", ["broken"]],
    ]);
    const [kind, near, trashed, hollow, followed] = r.issues.map((i) => i.message);
    expect(kind).toBe('s.icon names texture "boom", which is of kind audio');
    expect(near).toContain('did you mean "sky-art"?');
    expect(trashed).toContain("which is in the trash");
    expect(hollow).toContain("which has no content to fetch");
    expect(followed).toBe(
      '"broken" import.texture names texture "crate-art", which the project doesn\'t have; did you mean "crates-art"?',
    );
  });
});

describe("projectBundle", () => {
  const file = (game: Record<string, unknown>) => ({
    kind: "game-settings",
    v: 1,
    engine: {},
    game,
  });

  it("covers game-settings' asset fields, defaults applied", () => {
    const r = projectBundle(view, file({ icon: "icon-art" }), kinds, registry);
    expect(r.issues).toEqual([]);
    expect(r.bundle.name).toBe("project");
    expect(ids(r)).toEqual(["icon-art", "splash-art"]);
    expect(r.bundle.bytes).toBe(bytesOf("icon-art") + bytesOf("splash-art"));
  });

  it("reports a dangling id, and is empty without settings", () => {
    const r = projectBundle(view, file({ icon: "icon" }), kinds, registry);
    expect(r.issues.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["asset-missing", "/game/icon", ["game-settings"]],
    ]);
    expect(projectBundle(view, undefined, kinds, registry).bundle).toEqual({
      name: "project",
      entries: [],
      bytes: 0,
    });
  });
});
