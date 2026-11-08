import type { ProjectTreeNode } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import {
  ASSET_DRAG_TYPE,
  baseName,
  carriesAsset,
  docOfEntry,
  flattenTree,
  namesIn,
  parentFolder,
  readAssetDrag,
  registersSummary,
  renameProblem,
  writeAssetDrag,
} from "@/components/game/editor/project-tree/tree-rows";

import { entry, hero, ice, level, PROJECT, tree } from "./fixtures";

const sheet = entry("ksheet", "sprites/sheet.png", "atlas");
const withSheet = (): ProjectTreeNode[] => [
  { type: "folder", path: "sprites", children: [{ type: "asset", entry: sheet }] },
];
const framesOf = (e: { kind: string }) => (e.kind === "atlas" ? ["idle", "run-1"] : undefined);

/** A DataTransfer's surface, which node has none of. */
function transfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "all",
  } as unknown as DataTransfer;
}

describe("atlas frame rows", () => {
  it("lists an atlas's frames under it only while it's expanded", () => {
    const closed = flattenTree(withSheet(), new Set(), { framesOf });
    expect(closed.map((r) => r.key)).toEqual(["root", "folder:sprites", "asset:ksheet"]);
    expect(closed[2]).toMatchObject({ type: "asset", frames: ["idle", "run-1"] });

    const open = flattenTree(withSheet(), new Set(), {
      framesOf,
      expanded: new Set(["asset:ksheet"]),
    });
    expect(open.slice(3).map((r) => [r.type, r.key, r.depth])).toEqual([
      ["frame", "asset:ksheet#idle", 3],
      ["frame", "asset:ksheet#run-1", 3],
    ]);
    expect(open[3]).toMatchObject({ entry: sheet, frame: "idle", folder: "sprites/" });
  });

  it("gives a kind without frames no frame rows", () => {
    const rows = flattenTree(tree(), new Set(), { framesOf, expanded: new Set(["asset:khero"]) });
    expect(rows.some((r) => r.type === "frame")).toBe(false);
    expect(rows.find((r) => r.key === "asset:khero")).not.toHaveProperty("frames");
  });
});

describe("the asset drag", () => {
  it("round-trips an asset and its frame under its own type", () => {
    const data = transfer();
    expect(carriesAsset(data)).toBe(false);
    writeAssetDrag(data, { entry: sheet, info: { id: "sheet", kind: "atlas" }, frame: "idle" });
    expect(data.types).toEqual([ASSET_DRAG_TYPE]);
    expect(carriesAsset(data)).toBe(true);
    expect(data.effectAllowed).toBe("copyMove");
    expect(readAssetDrag(data)).toEqual({
      entry: sheet,
      info: { id: "sheet", kind: "atlas" },
      frame: "idle",
    });
  });

  it("reads nothing from another drag or a malformed payload", () => {
    expect(readAssetDrag(null)).toBeNull();
    const data = transfer();
    data.setData(ASSET_DRAG_TYPE, "{not json");
    expect(readAssetDrag(data)).toBeNull();
    data.setData(ASSET_DRAG_TYPE, JSON.stringify({ entry: { id: 1 } }));
    expect(readAssetDrag(data)).toBeNull();
  });
});

describe("tree rows", () => {
  it("splits paths into folders and names", () => {
    expect(baseName("sprites/hero.png")).toBe("hero.png");
    expect(baseName("sprites/")).toBe("sprites");
    expect(parentFolder("sprites/enemies/bat.png")).toBe("sprites/enemies/");
    expect(parentFolder("ice.material.json")).toBe("");
  });

  it("flattens depth first, counting files and skipping collapsed folders", () => {
    const rows = flattenTree(tree(), new Set(["folder:sprites"]));
    expect(rows.map((r) => [r.key, r.depth])).toEqual([
      ["root", 0],
      ["folder:scenes", 1],
      ["asset:klevel", 2],
      ["folder:sfx", 1],
      ["asset:kjump", 2],
      ["folder:sprites", 1],
      ["folder:src", 1],
      ["code:src/game.ts", 2],
      ["asset:kice", 1],
    ]);
    const sprites = rows.find((r) => r.key === "folder:sprites");
    expect(sprites).toMatchObject({ folder: "sprites/", count: 1 });
  });

  it("names a scene's doc scene: and every other kind's asset:", () => {
    expect(docOfEntry(PROJECT, level)).toBe(`scene:${PROJECT}.klevel`);
    expect(docOfEntry(PROJECT, ice)).toBe(`asset:${PROJECT}.kice`);
    expect(docOfEntry("Not An Id", ice)).toBeNull();
  });

  it("checks a new file name against the path rules and its siblings", () => {
    const siblings = namesIn(tree(), "sprites/");
    expect(siblings).toEqual(["hero.png"]);
    expect(renameProblem(hero, "hero-2.png", siblings)).toBeNull();
    expect(renameProblem(hero, "HERO.png", siblings)).toBeNull();
    expect(renameProblem(hero, "a/b.png", siblings)).toMatch(/letters/);
    expect(renameProblem(hero, "..", siblings)).toMatch(/letters/);
    expect(renameProblem(ice, "ICE.material.json", ["ice.material.json", "x.json"])).toBeNull();
    expect(renameProblem(ice, "X.json", namesIn(tree(), ""))).toBeNull();
    expect(renameProblem(ice, "Scenes", namesIn(tree(), ""))).toMatch(/already/);
  });

  it("summarises what a code module registers", () => {
    expect(registersSummary({ registers: { types: ["a", "b"], tables: ["t"] } })).toBe(
      "2 types, 1 table",
    );
    expect(registersSummary({ registers: {} })).toBe("");
  });
});
