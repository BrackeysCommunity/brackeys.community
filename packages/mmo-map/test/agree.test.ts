import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import type { MapCell, MapOverlay, MapTileView } from "../../mmo-api/src/index.ts";
import { hexKey } from "../src/hex.ts";
import { liveByHex, mergeTile } from "../src/merge.ts";

// Written by services/mmo-world/service/map_proof_test.go
// (TestMapCropAgreesWithSite -update): one character's disc as the site
// fetches it, the found cells of the tile chunks covering it and the
// overlay over those chunks, and the view /v1/map gave the same character.
interface Golden {
  character: string;
  radius: number;
  tick: number;
  ticksPerDay: number;
  base: MapCell[];
  overlay: MapOverlay;
  view: MapTileView[];
}

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/agree.json", import.meta.url), "utf8"),
) as Golden;

function byRQ(a: MapTileView, b: MapTileView): number {
  return a.cell.r - b.cell.r || a.cell.q - b.cell.q;
}

describe("the site's merge agrees with /map", () => {
  test("the base and the overlay merge to /v1/map's view, tile for tile", () => {
    const live = liveByHex(golden.overlay);
    const cells = [...golden.base];
    const own = golden.overlay.self?.cell;
    if (own) cells.push(own);
    const merged = cells.map((c) => mergeTile(c, live.get(hexKey(c)))).sort(byRQ);
    expect(merged).toEqual(golden.view);
  });

  test("the golden holds a tile in sight, one last seen and one found and never seen", () => {
    const fogs = new Set(golden.view.map((v) => v.fog));
    expect(fogs).toEqual(new Set(["sight", "seen", "discovered"]));
    expect(golden.overlay.viewer).toBe("character");
    expect(golden.overlay.self?.character).toBe(golden.character);
  });

  test("a last-seen tile carries the tick it left sight; a never-seen one no live layer", () => {
    for (const v of golden.view) {
      if (v.fog === "seen") expect(v.live?.left).toBeLessThanOrEqual(golden.tick);
      if (v.fog === "discovered") expect(v.live).toBeUndefined();
    }
  });
});
