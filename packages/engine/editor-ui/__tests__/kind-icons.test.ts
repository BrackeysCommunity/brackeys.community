// @vitest-environment node
import { File01Icon, PuzzleIcon } from "@hugeicons/core-free-icons";
import { describe, expect, it } from "vite-plus/test";

import { ENGINE_ASSET_KINDS } from "../../project/kinds/index";
import { kindIcon } from "../panels/project-tree/kind-icons";

describe("kindIcon", () => {
  it("gives every engine asset kind an icon of its own", () => {
    const kinds = ENGINE_ASSET_KINDS.map((k) => k.kind);
    for (const kind of kinds) {
      expect(kindIcon(kind), kind).not.toBe(File01Icon);
      expect(kindIcon(kind), kind).not.toBe(PuzzleIcon);
    }
    expect(new Set(kinds.map(kindIcon)).size).toBe(kinds.length);
  });

  it("shares one icon across a game's own kinds and falls back to a file", () => {
    expect(kindIcon("platformer/level-pack")).toBe(PuzzleIcon);
    expect(kindIcon("not-a-kind")).toBe(File01Icon);
  });
});
