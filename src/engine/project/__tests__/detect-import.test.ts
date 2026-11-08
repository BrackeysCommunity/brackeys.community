import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createKindRegistry, detectImport } from "../kinds";
import { atlasExportApp } from "../kinds/atlas";
import { ENGINE_ASSET_KINDS } from "../kinds/index";

const fixtureJson = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const kinds = createKindRegistry(null);
const hero = fixtureJson("hero.json");
const items = fixtureJson("items.json");

describe("atlasExportApp", () => {
  it("names the tool an export's meta.app gives, and nothing for other JSON", () => {
    expect(atlasExportApp(hero)).toBe("aseprite");
    expect(atlasExportApp(items)).toBe("texturepacker");
    expect(atlasExportApp({ frames: {}, meta: { app: "http://www.aseprite.org/" } })).toBe(
      "aseprite",
    );
    expect(atlasExportApp({ frames: {} })).toBeNull();
    expect(atlasExportApp({ frames: {}, meta: { app: "free-tex-packer" } })).toBeNull();
    expect(atlasExportApp({ meta: { app: "https://www.aseprite.org/" } })).toBeNull();
    expect(
      atlasExportApp({ kind: "material", frames: {}, meta: { app: "https://www.aseprite.org/" } }),
    ).toBeNull();
    expect(atlasExportApp([hero])).toBeNull();
  });
});

describe("detectImport", () => {
  it("takes an Aseprite or TexturePacker JSON as an atlas, though detection by path doesn't", () => {
    expect(kinds.detect("art/hero.json", hero)).toBeNull();
    expect(detectImport(kinds, "art/hero.json", hero)?.kind).toBe("atlas");
    expect(detectImport(kinds, "art/items.json", items)?.kind).toBe("atlas");
    expect(detectImport(kinds, "art/hero.json")).toBeNull();
  });

  it("keeps detect's answer first, and leaves what isn't an atlas export alone", () => {
    expect(detectImport(kinds, "art/hero.atlas.json", { frames: {} })?.kind).toBe("atlas");
    expect(detectImport(kinds, "art/hero.png")?.kind).toBe("texture");
    expect(detectImport(kinds, "level.json", { v: 2, name: "l", entities: [] })?.kind).toBe(
      "scene",
    );
    expect(detectImport(kinds, "art/frames.json", { frames: {} })).toBeNull();
    expect(detectImport(kinds, "art/hero.txt", hero)).toBeNull();
    expect(detectImport(kinds, "__tests__/hero.json", hero)).toBeNull();
    expect(detectImport(kinds, "art/hero.json.asset.json", hero)).toBeNull();
  });

  it("finds nothing in a registry without the atlas kind", () => {
    const bare = createKindRegistry(
      null,
      ENGINE_ASSET_KINDS.filter((k) => k.kind !== "atlas"),
    );
    expect(detectImport(bare, "art/hero.json", hero)).toBeNull();
  });
});
