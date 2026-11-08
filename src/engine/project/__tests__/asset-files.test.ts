import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  assetFileEntries,
  orphanSidecarIssue,
  ownAssetId,
  projectPathMatcher,
} from "../asset-files";
import { sha256 } from "../hash";
import { createKindRegistry } from "../kinds";
import type { AssetSidecar } from "../sidecar";
import type { ProjectFile } from "../types";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const kinds = createKindRegistry(null);
const file: ProjectFile = {
  kind: "project",
  v: 1,
  id: "test",
  name: "Test",
  game: null,
  assets: ["**/*", "!raw/**"],
  code: ["src/**/*.ts", "!src/**/*.gen.ts"],
  ignore: ["tmp/**"],
};

const sidecar = (extra: Partial<AssetSidecar>): AssetSidecar =>
  ({ kind: "asset-sidecar", v: 1, ...extra }) as AssetSidecar;

describe("projectPathMatcher", () => {
  const { isAsset, isCode } = projectPathMatcher(file, matchesGlob);

  it("applies the globs, their excludes, ignore and the fixed skips", () => {
    expect(isAsset("art/crate.png")).toBe(true);
    expect(isAsset("raw/crate.png")).toBe(false);
    expect(isAsset("tmp/crate.png")).toBe(false);
    expect(isAsset("art/crate.png.asset.json")).toBe(false);
    expect(isAsset("art/__tests__/crate.png")).toBe(false);
    expect(isCode("src/game.ts")).toBe(true);
    expect(isCode("src/game.gen.ts")).toBe(false);
    expect(isCode("tmp/game.ts")).toBe(false);
  });
});

describe("ownAssetId", () => {
  it("takes a doc kind's id field, else the file name", () => {
    const prefab = kinds.get("prefab")!;
    const texture = kinds.get("texture")!;
    expect(ownAssetId(texture, "art/Big Crate.png", undefined)).toBe("big-crate");
    expect(ownAssetId(prefab, "prefabs/gate.json", { id: "door" })).toBe("door");
    expect(ownAssetId(prefab, "prefabs/gate.json", { id: 3 })).toBe("gate");
  });
});

describe("orphanSidecarIssue", () => {
  it("names the sidecar and the missing file", () => {
    expect(orphanSidecarIssue("a.png.asset.json", "a.png")).toMatchObject({
      code: "ref-not-found",
      message: "a.png.asset.json is a sidecar with no asset file beside it",
      got: "a.png",
    });
  });
});

describe("assetFileEntries", () => {
  const texture = kinds.get("texture")!;
  const png = fixture("hero.png");

  it("suffixes colliding keys in order and keeps the sidecar's name, licence and settings", async () => {
    const blob = { sha256: await sha256(png), data: png };
    const out = assetFileEntries(
      [
        { path: "a/crate.png", def: texture, id: "crate", sidecar: null, blob },
        {
          path: "b/crate.png",
          def: texture,
          id: "crate",
          sidecar: sidecar({
            name: "Crate B",
            licence: { spdx: "CC0-1.0" },
            import: { filter: "linear" },
          } as Partial<AssetSidecar>),
          blob,
        },
      ],
      { at: 0, by: "disk" },
    );
    expect(out.map((o) => o.key)).toEqual(["crate", "crate-2"]);
    expect(out[1]!.entry).toMatchObject({
      key: "crate-2",
      id: "crate",
      name: "Crate B",
      licence: { spdx: "CC0-1.0" },
      import: { filter: "linear" },
      sha256: blob.sha256,
      bytes: png.byteLength,
      meta: { format: "png" },
    });
    expect(out.every((o) => o.issue === null)).toBe(true);
  });

  it("returns a failed inspection as the issue and leaves the entry without meta", async () => {
    const junk = new Uint8Array([1, 2, 3]);
    const [only] = assetFileEntries(
      [
        {
          path: "bad.png",
          def: texture,
          id: "bad",
          sidecar: null,
          blob: { sha256: await sha256(junk), data: junk },
        },
      ],
      { at: 0, by: "disk" },
    );
    expect(only!.issue).not.toBeNull();
    expect(only!.entry.meta).toBeUndefined();
    expect(only!.entry.bytes).toBe(3);
  });
});
