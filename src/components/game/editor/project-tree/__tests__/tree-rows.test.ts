import { describe, expect, it } from "vite-plus/test";

import {
  baseName,
  docOfEntry,
  flattenTree,
  namesIn,
  parentFolder,
  registersSummary,
  renameProblem,
} from "@/components/game/editor/project-tree/tree-rows";

import { hero, ice, level, PROJECT, tree } from "./fixtures";

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
