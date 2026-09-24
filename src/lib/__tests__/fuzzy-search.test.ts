import { describe, expect, it } from "vite-plus/test";

import { foldText, fuzzyFilter } from "@/lib/fuzzy-search";

const skills = [
  "LÖVE",
  "Godot",
  "GDScript",
  "Unreal Engine",
  "RPG Maker",
  "Blender",
  "C#",
  "C++",
  "C",
  "Go",
].map((name, id) => ({ id, name }));
const names = (q: string) => fuzzyFilter(skills, q).map((s) => s.name);

describe("foldText", () => {
  it("strips diacritics and case", () => {
    expect(foldText("LÖVE")).toBe("love");
    expect(foldText("Crème Brûlée")).toBe("creme brulee");
  });
});

describe("fuzzyFilter", () => {
  it("finds an accented name from plain ASCII", () => {
    expect(names("love")).toEqual(["LÖVE"]);
    expect(names("löve")).toEqual(["LÖVE"]);
  });

  it("finds LÖVE by the name the community uses", () => {
    expect(names("love2d")[0]).toBe("LÖVE");
  });

  it("forgives a typo", () => {
    expect(names("godto")[0]).toBe("Godot");
    expect(names("blendr")[0]).toBe("Blender");
  });

  it("ranks an exact name first", () => {
    expect(names("go")[0]).toBe("Go");
    expect(names("c")[0]).toBe("C");
  });

  it("returns everything, in order, for an empty query", () => {
    expect(names("  ")).toEqual(skills.map((s) => s.name));
  });

  it("does not match unrelated names", () => {
    expect(names("zzz")).toEqual([]);
  });
});
