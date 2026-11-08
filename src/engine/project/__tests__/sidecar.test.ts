import { describe, expect, it } from "vite-plus/test";

import { formatSidecar, parseSidecar, sidecarPathOf, type AssetSidecar } from "../sidecar";

const HASH = "9f2c".padEnd(64, "0");

const texture: AssetSidecar = {
  kind: "asset-sidecar",
  v: 1,
  key: "crate",
  id: "crate",
  assetKind: "texture",
  sha256: HASH,
  bytes: 1832,
  import: { filter: "nearest" },
  meta: { format: "png", width: 32, height: 32 },
  licence: { spdx: "CC0-1.0", author: "Ana" },
};

const TEXTURE_TEXT = `{
  "kind": "asset-sidecar",
  "v": 1,
  "id": "crate",
  "sha256": "${HASH}",
  "bytes": 1832,
  "import": { "filter": "nearest" },
  "meta": { "format": "png", "height": 32, "width": 32 },
  "licence": { "spdx": "CC0-1.0", "author": "Ana" }
}
`;

const codesOf = (input: unknown) => {
  const r = parseSidecar(input);
  return r.ok ? [] : r.issues.map((i) => [i.code, i.path]);
};

describe("formatSidecar", () => {
  it("omits key when it equals id, and assetKind when detection gives it", () => {
    expect(formatSidecar(texture, { detectedKind: "texture" })).toBe(TEXTURE_TEXT);
  });

  it("keeps a key that differs from the id, and a kind detection wouldn't give", () => {
    const text = formatSidecar(
      { ...texture, key: "k3j9x0a1b2c3", assetKind: "atlas" },
      { detectedKind: null },
    );
    expect(text).toContain(`  "key": "k3j9x0a1b2c3",\n  "id": "crate",\n  "assetKind": "atlas",\n`);
    expect(
      formatSidecar({ ...texture, assetKind: "atlas" }, { detectedKind: "texture" }),
    ).toContain(`"assetKind": "atlas"`);
    expect(formatSidecar(texture)).toContain(`"assetKind": "texture"`);
  });

  it("is stable under key order, sorting free records at every depth", () => {
    const shuffled = {
      licence: { author: "Ana", spdx: "CC0-1.0" },
      meta: { width: 32, height: 32, format: "png" },
      import: { filter: "nearest" },
      bytes: 1832,
      sha256: HASH,
      assetKind: "texture",
      id: "crate",
      key: "crate",
      v: 1,
      kind: "asset-sidecar",
    } as AssetSidecar;
    expect(formatSidecar(shuffled, { detectedKind: "texture" })).toBe(TEXTURE_TEXT);
    expect(formatSidecar({ ...texture, meta: { z: { b: 1, a: 2 }, a: 0 } })).toContain(
      `"meta": { "a": 0, "z": { "a": 2, "b": 1 } }`,
    );
  });

  it("accepts a sidecar without a key", () => {
    const { key: _key, ...noKey } = texture;
    expect(formatSidecar(noKey, { detectedKind: "texture" })).toBe(TEXTURE_TEXT);
  });
});

describe("parseSidecar", () => {
  it("fills key from id, and leaves assetKind to detection", () => {
    const r = parseSidecar(TEXTURE_TEXT);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.sidecar.key).toBe("crate");
    expect(r.sidecar.assetKind).toBeUndefined();
    expect(r.sidecar.meta).toEqual({ format: "png", width: 32, height: 32 });
  });

  it("round-trips: format of a parse is the same text", () => {
    const texts = [
      TEXTURE_TEXT,
      formatSidecar({ ...texture, key: "k3j9x0a1b2c3", name: "Wooden crate" }),
      formatSidecar({
        kind: "asset-sidecar",
        v: 1,
        id: "intro",
        licence: { attribution: "Music by Ana (CC-BY-4.0)", spdx: "CC-BY-4.0" },
      }),
      formatSidecar({
        ...texture,
        meta: {
          frames: [
            { x: 0, y: 0, w: 16, h: 16 },
            { x: 16, y: 0, w: 16, h: 16 },
          ],
        },
      }),
    ];
    for (const text of texts) {
      const r = parseSidecar(text);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      expect(formatSidecar(r.sidecar)).toBe(text);
    }
  });

  it("refuses bad JSON, another kind, a newer v", () => {
    expect(codesOf("nope")).toEqual([["schema", ""]]);
    expect(codesOf({ kind: "project", v: 1, id: "a" })).toEqual([["schema", "/kind"]]);
    expect(codesOf({ kind: "asset-sidecar", v: 3, id: "a" })).toEqual([["version-newer", "/v"]]);
  });

  it("refuses unknown keys, bad ids and keys, bad kinds and hashes", () => {
    const base = { kind: "asset-sidecar", v: 1, id: "a" };
    expect(codesOf({ ...base, hash: HASH })).toEqual([["unknown-key", "/hash"]]);
    expect(codesOf({ ...base, licence: { spdx: "MIT", year: 2020 } })).toEqual([
      ["unknown-key", "/licence/year"],
    ]);
    expect(codesOf({ ...base, id: "A" })).toEqual([["bad-id", "/id"]]);
    expect(codesOf({ ...base, key: "no spaces" })).toEqual([["bad-id", "/key"]]);
    expect(codesOf({ ...base, assetKind: "Texture" })).toEqual([["schema", "/assetKind"]]);
    expect(codesOf({ ...base, assetKind: "platformer/spring" })).toEqual([]);
    expect(codesOf({ ...base, sha256: "abc", bytes: 1 })).toEqual([["schema", "/sha256"]]);
    expect(codesOf({ ...base, sha256: HASH, bytes: -1 })).toEqual([["schema", "/bytes"]]);
  });

  it("wants sha256 and bytes together", () => {
    const base = { kind: "asset-sidecar", v: 1, id: "a" };
    expect(codesOf({ ...base, sha256: HASH })).toEqual([["schema", "/bytes"]]);
    expect(codesOf({ ...base, bytes: 4 })).toEqual([["schema", "/bytes"]]);
  });
});

describe("sidecarPathOf", () => {
  it("puts the sidecar beside its file", () => {
    expect(sidecarPathOf("art/crate.png")).toBe("art/crate.png.asset.json");
  });
});
