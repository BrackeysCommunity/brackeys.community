// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveResolution, viewportFor } from "@jams/engine";
import {
  atlasKind,
  inspectEntry,
  textureKind,
  type AtlasMeta,
  type BlobKindDef,
} from "@jams/engine/project";
import {
  createRegistry,
  expandScene,
  parsePrefab,
  parseScene,
  prefabLibrary,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { tacticsGame } from "..";
import {
  CELL_PX,
  makeArt,
  TERRAIN_KINDS,
  terrainFile,
  UNIT_ART_CLASSES,
  UNIT_ART_SIDES,
  UNIT_FRAMES,
  unitFrame,
} from "../art/make-art";

const here = (path: string) => new URL(path, import.meta.url);
const bytesOf = (path: string) => new Uint8Array(readFileSync(here(path)));
const textOf = (path: string) => readFileSync(here(path), "utf8");
const REPO = fileURLToPath(here("../../../../"));

type Sidecar = {
  id: string;
  sha256: string;
  bytes: number;
  import?: Record<string, unknown>;
  meta: unknown;
  licence?: { spdx?: string };
};
const sidecar = (name: string) => JSON.parse(textOf(`../art/${name}.asset.json`)) as Sidecar;

/** The art's paths in the project and the ids its sidecars give them. */
const IDS: Record<string, string> = {
  "art/units.png": "units-texture",
  "art/units.json": "units",
  "art/tiles.png": "tiles",
  "art/tile-wall.png": "tile-wall",
  "art/tile-marsh.png": "tile-marsh",
  "art/tile-thicket.png": "tile-thicket",
};
const idAt = (path: string) => IDS[path];

const registry = createRegistry(tacticsGame);

/** The palette index make-art's tRNS chunk marks fully transparent. */
const TRANSPARENT = 0;

/** A make-art PNG's palette indices, row by row: its IDAT is a zlib stream of stored blocks. */
function paletteImage(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const data = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  const idat: number[] = [];
  for (let at = 8; at < png.length; ) {
    const length = data.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.getUint32(at + 8);
      height = data.getUint32(at + 12);
      expect([body[8], body[9]], "an 8-bit palette image").toEqual([8, 3]);
    }
    if (type === "IDAT") idat.push(...body);
    at += 12 + length;
  }
  const raw: number[] = [];
  for (let at = 2, last = 0; !last; ) {
    last = idat[at]! & 1;
    expect(idat[at]! >> 1, "a stored deflate block").toBe(0);
    const len = idat[at + 1]! | (idat[at + 2]! << 8);
    raw.push(...idat.slice(at + 5, at + 5 + len));
    at += 5 + len;
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width + 1)], "no row filter").toBe(0);
    pixels.set(raw.slice(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return { width, height, pixels };
}

describe("make-art.ts", () => {
  it("reproduces every committed art file byte for byte", () => {
    const art = makeArt();
    expect([...art.keys()].sort()).toEqual(
      [
        "tile-marsh.png",
        "tile-thicket.png",
        "tile-wall.png",
        "tiles.png",
        "units.json",
        "units.png",
      ].sort(),
    );
    for (const [name, bytes] of art) expect(bytes, name).toEqual(bytesOf(`../art/${name}`));
  });

  it("matches each file's sidecar hash and size, licensed CC0-1.0", () => {
    for (const [name, bytes] of makeArt()) {
      const car = sidecar(name);
      expect(car.id).toBe(IDS[`art/${name}`]);
      expect(car.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(car.bytes).toBe(bytes.length);
      expect(car.licence?.spdx).toBe("CC0-1.0");
    }
  });

  it("names frames and tags without another game's words", () => {
    const words = /\b(shaper|grapple|wind|constructs?|cheese|cloud|mover)\b/i;
    const names = [...UNIT_FRAMES, ...UNIT_ART_SIDES];
    expect(names.filter((n) => words.test(n))).toEqual([]);
  });
});

describe("the unit sheet", () => {
  const inspected = () => {
    const result = inspectEntry(
      atlasKind as BlobKindDef,
      { path: "art/units.json" },
      bytesOf("../art/units.json"),
      idAt,
    );
    if (!result.ok) throw new Error(result.issue.message);
    return result as { meta: AtlasMeta; import?: Record<string, unknown> };
  };

  it("imports as an Aseprite atlas with one cell-sized frame per class and side", () => {
    const { meta, import: settings } = inspected();
    expect(meta.tool).toBe("aseprite");
    expect(settings).toEqual({ texture: "units-texture" });
    expect(meta.order).toEqual(UNIT_FRAMES);
    expect(UNIT_FRAMES).toHaveLength(UNIT_ART_CLASSES.length * UNIT_ART_SIDES.length);
    UNIT_FRAMES.forEach((name, i) =>
      expect(meta.frames[name]).toMatchObject({ x: i * CELL_PX, y: 0, w: CELL_PX, h: CELL_PX }),
    );
    expect(meta.tags.map((t) => [t.name, t.from, t.to])).toEqual([
      ["blue", 0, 2],
      ["red", 3, 5],
    ]);
  });

  it("is what its sidecar records", () => {
    const { meta } = inspected();
    expect(sidecar("units.json").meta).toEqual(meta);
  });

  it("cuts a texture as wide as its frames", () => {
    const result = inspectEntry(
      textureKind as BlobKindDef,
      { path: "art/units.png" },
      bytesOf("../art/units.png"),
      idAt,
    );
    expect(result).toMatchObject({
      ok: true,
      meta: { format: "png", width: CELL_PX * UNIT_FRAMES.length, height: CELL_PX },
    });
  });
});

describe("drawing", () => {
  it("samples nearest and scales by whole multiples inside letterbox bars", () => {
    const policy = resolveResolution({ game: tacticsGame.resolution });
    expect(policy).toMatchObject({ fit: "letterbox", integer: true, sampling: "nearest" });
    for (const name of ["units.png", "tiles.png", ...TERRAIN_KINDS.map(terrainFile)])
      expect(sidecar(name).import?.filter).toBe("nearest");
    for (const canvas of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 700, height: 500 },
    ]) {
      const v = viewportFor(policy, canvas);
      expect(Number.isInteger(v.scale)).toBe(true);
      expect(v.view).toEqual({ width: 576, height: 384 });
      expect(v.offset).toEqual({
        x: Math.floor((canvas.width - 576 * v.scale) / 2),
        y: Math.floor((canvas.height - 384 * v.scale) / 2),
      });
    }
  });

  it("draws a frame and a tile cell one board cell across", () => {
    expect(tacticsGame.world?.lengthUnit).toBe(CELL_PX);
    const tiles = inspectEntry(
      textureKind as BlobKindDef,
      { path: "art/tiles.png" },
      bytesOf("../art/tiles.png"),
      idAt,
    );
    // A 2 × 2 checker of cells, so the board's 12 × 8 cells tile it whole.
    expect(tiles).toMatchObject({ ok: true, meta: { width: 2 * CELL_PX, height: 2 * CELL_PX } });
  });

  it("draws walls, marsh and thicket as one opaque board cell each", () => {
    expect([...TERRAIN_KINDS].sort()).toEqual(["marsh", "thicket", "wall"]);
    for (const kind of TERRAIN_KINDS) {
      const file = terrainFile(kind);
      const result = inspectEntry(
        textureKind as BlobKindDef,
        { path: `art/${file}` },
        bytesOf(`../art/${file}`),
        idAt,
      );
      expect(result, file).toMatchObject({
        ok: true,
        meta: { format: "png", width: CELL_PX, height: CELL_PX },
      });
      expect(sidecar(file).id).toBe(`tile-${kind}`);
      const { width, height, pixels } = paletteImage(bytesOf(`../art/${file}`));
      expect([width, height], file).toEqual([CELL_PX, CELL_PX]);
      expect(pixels.indexOf(TRANSPARENT), `${file} has a see-through pixel`).toBe(-1);
    }
    // The unit sheet's sprites stand on a transparent cell, so the reading above can see one.
    expect(paletteImage(bytesOf("../art/units.png")).pixels.includes(TRANSPARENT)).toBe(true);
  });
});

describe("level 1", () => {
  const expanded = () => {
    const scene = parseScene(textOf("../scenes/level-1.json"), registry);
    if (!scene.ok) throw new Error(scene.issues.map((i) => i.message).join("\n"));
    const prefabs = ["knight", "archer"].map((id) => {
      const p = parsePrefab(textOf(`../scenes/prefabs/${id}.json`), registry);
      if (!p.ok) throw new Error(p.issues.map((i) => i.message).join("\n"));
      return p.prefab;
    });
    return expandScene(scene.def, registry, { prefabs: prefabLibrary(prefabs) });
  };

  it("draws each unit with its class's frame on its side's colours", () => {
    const units = expanded().entities.filter((e) => e.type === "unit");
    expect(units).toHaveLength(5);
    for (const u of units) {
      const sprite = (u.behaviors as { sprite?: { asset?: string; frame?: string } }).sprite;
      expect(sprite?.asset, u.id).toBe("units");
      expect(sprite?.frame, u.id).toBe(unitFrame(String(u.class), String(u.side)));
    }
  });

  it("lays the grass under the whole board", () => {
    const ground = expanded().entities.find((e) => e.id === "ground");
    expect(ground).toMatchObject({
      type: "decor",
      layer: "terrain",
      at: [6, 4],
      behaviors: { sprite: { asset: "tiles", size: [12, 8], tile: true } },
    });
  });

  it("validates against the project, its sprites and assets included", () => {
    const r = spawnSync(
      "bun",
      ["scripts/scene/cli.ts", "validate", "level-1", "--project", "tactics"],
      {
        cwd: REPO,
        encoding: "utf8",
      },
    );
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("0 errors, 0 warnings");
  }, 60_000);
});
