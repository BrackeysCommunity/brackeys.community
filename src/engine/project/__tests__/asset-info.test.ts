import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { assetInfo } from "../asset-info";
import { atlasKind } from "../kinds/atlas";
import { textureKind } from "../kinds/texture";
import type { AssetEntry, ProjectState } from "../types";
import { projectView } from "../view";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const created = { at: 0, by: "test" };
const HASH = "a".repeat(64);

function inspected(
  kind: typeof textureKind | typeof atlasKind,
  bytes: Uint8Array,
  settings: Record<string, unknown>,
) {
  const result = kind.inspect(bytes, settings as never, {
    path: "art/x",
    idAt: () => undefined,
  });
  if (!result.ok) throw new Error(result.issue.message);
  return result.meta as Record<string, unknown>;
}

const itemsArt: AssetEntry = {
  key: "items-art",
  id: "items-art",
  kind: "texture",
  path: "art/items.png",
  sha256: HASH,
  bytes: fixture("items.png").length,
  meta: inspected(textureKind, fixture("items.png"), {}),
  import: { filter: "linear", pivot: [0.5, 1], nineSlice: [1, 2, 3, 4] },
  created,
};
const items: AssetEntry = {
  key: "items",
  id: "items",
  kind: "atlas",
  path: "art/items.json",
  sha256: "b".repeat(64),
  bytes: 10,
  meta: inspected(atlasKind, fixture("items.json"), { pivotDefault: [0, 0] }),
  import: { texture: "items-art", pivotDefault: [0, 0] },
  created,
};
const gone: AssetEntry = {
  key: "gone",
  id: "gone",
  kind: "texture",
  path: "art/gone.png",
  sha256: HASH,
  bytes: 1,
  created,
  deleted: { at: 1, by: "test" },
};
const yard: AssetEntry = { key: "yard", id: "yard", kind: "scene", path: "yard.json", created };

const state: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: Object.fromEntries([itemsArt, items, gone, yard].map((e) => [e.key, e])),
  history: {},
  code: {},
  build: {},
};
const view = projectView(state);

describe("assetInfo", () => {
  it("gives a texture's size with its import pivot, nine-slice and filter", () => {
    expect(assetInfo(view, "items-art")).toEqual({
      id: "items-art",
      kind: "texture",
      sha256: HASH,
      bytes: itemsArt.bytes,
      size: [16, 16],
      pivot: [0.5, 1],
      nineSlice: [1, 2, 3, 4],
      filter: "linear",
    });
  });

  it("gives an atlas's frames in file order, its tags and its texture", () => {
    expect(assetInfo(view, "items")).toEqual({
      id: "items",
      kind: "atlas",
      sha256: "b".repeat(64),
      bytes: 10,
      frames: ["coin.png", "gem.png", "panel.png"],
      tags: [{ name: "spin", from: 0, to: 1, direction: "forward" }],
      texture: "items-art",
    });
  });

  it("gives a frame's size and pivot, the pivot default filling a frame without one", () => {
    expect(assetInfo(view, "items", "gem.png")).toMatchObject({
      id: "items",
      size: [8, 8],
      pivot: [0.5, 1],
      texture: "items-art",
    });
    expect(assetInfo(view, "items", "panel.png")).toMatchObject({ size: [12, 8], pivot: [0, 0] });
  });

  it("is null for a frame the asset doesn't have, or a frame of a texture", () => {
    expect(assetInfo(view, "items", "nope.png")).toBeNull();
    expect(assetInfo(view, "items", "__proto__")).toBeNull();
    expect(assetInfo(view, "items-art", "coin.png")).toBeNull();
  });

  it("is null for an id with no live asset, trashed ones included", () => {
    expect(assetInfo(view, "missing")).toBeNull();
    expect(assetInfo(view, "gone")).toBeNull();
  });

  it("gives a doc asset its id and kind, and a blob whose meta doesn't fit no size", () => {
    expect(assetInfo(view, "yard")).toEqual({ id: "yard", kind: "scene" });
    const odd = projectView({
      ...state,
      assets: { x: { ...itemsArt, key: "x", id: "x", meta: { width: "big" }, import: {} } },
    });
    expect(assetInfo(odd, "x")).toEqual({
      id: "x",
      kind: "texture",
      sha256: HASH,
      bytes: itemsArt.bytes,
    });
  });
});
