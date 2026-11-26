// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { MapCell, MapTileView } from "../../../../packages/mmo-api/src/index.ts";
import { TICKS_PER_DAY } from "../../../../packages/mmo-words/src/units.ts";
import { TilePanel, tileWords } from "../TilePanel";

const CELL: MapCell = {
  q: 3,
  r: -2,
  terrain: "ash-flats",
  region: "region-4",
  road: 2,
  roadName: "The Long Wire",
  place: "settlement",
  placeRef: "settlement-7",
  guild: "guild-1",
};
const NAMES = {
  "region-4": "the Cinder Reach",
  "settlement-7": "Rustwater",
  "guild-1": "the Lamplighters",
};
const DAY = TICKS_PER_DAY;
const AT = { tick: 10 * DAY, names: NAMES };

const sight: MapTileView = {
  cell: CELL,
  fog: "sight",
  live: { q: 3, r: -2, fog: "sight", threat: 40, weather: "dust-storm", busy: "busy" },
};
const seen: MapTileView = {
  cell: CELL,
  fog: "seen",
  live: { q: 3, r: -2, fog: "seen", left: 7 * DAY + 5, threat: 12, toll: 3 },
};
const discovered: MapTileView = { cell: CELL, fog: "discovered" };

afterEach(cleanup);

describe("tileWords", () => {
  it("names the base the same in every fog state", () => {
    for (const t of [sight, seen, discovered]) {
      const w = tileWords(t, AT);
      expect(w.title).toBe("Rustwater");
      expect(w.base).toEqual([
        "Ash flats",
        "In the Cinder Reach",
        "A settlement, run by the Lamplighters",
        "The Long Wire, a road at level 2",
      ]);
    }
  });

  it("gives a tile in sight its live values now, with no age", () => {
    const w = tileWords(sight, AT);
    expect(w.fogLine).toBe("In sight.");
    expect(w.age).toBeUndefined();
    expect(w.live).toEqual(["40 threat in its region", "Weather: dust storm", "How busy: busy"]);
  });

  it("gives a last-seen tile its age and the values as they were", () => {
    const w = tileWords(seen, AT);
    expect(w.fogLine).toBe("Last seen.");
    expect(w.age).toBe("Seen 2 world days ago.");
    expect(w.live).toEqual([
      "12 threat in its region",
      "Tolled: 3 coins a crossing",
      "How busy: quiet",
    ]);
  });

  it("reads under a day and one day as words", () => {
    const left = (ago: number): MapTileView => ({
      ...seen,
      live: { ...seen.live!, left: AT.tick - ago },
    });
    expect(tileWords(left(DAY - 1), AT).age).toBe("Seen less than a world day ago.");
    expect(tileWords(left(DAY), AT).age).toBe("Seen 1 world day ago.");
  });

  it("gives a discovered tile out of sight nothing live", () => {
    const w = tileWords(discovered, AT);
    expect(w.fogLine).toBe("Found, not seen by you.");
    expect(w.age).toBeUndefined();
    expect(w.live).toEqual([]);
  });

  it("calls ground nobody has found unknown, and says nothing else", () => {
    const w = tileWords(undefined, AT);
    expect(w).toMatchObject({ title: "Unknown ground", fog: "unknown", base: [], live: [] });
    expect(w.fogLine).toBe("Nobody has been here.");
  });

  it("marks the viewer's own tile", () => {
    expect(tileWords(sight, { ...AT, self: { q: 3, r: -2 } }).base).toContain("You are here.");
  });
});

describe("TilePanel", () => {
  it("shows a last-seen tile's age and its old values under their own label", () => {
    render(<TilePanel tile={seen} at={AT} onClose={() => {}} />);
    expect(screen.getByText("Last seen.")).toBeTruthy();
    expect(screen.getByText(/Seen 2 world days ago\. As it was then:/)).toBeTruthy();
    expect(screen.getByText("Last seen")).toBeTruthy();
    expect(screen.getByText("12 threat in its region")).toBeTruthy();
  });

  it("shows a tile in sight as in sight now", () => {
    render(<TilePanel tile={sight} at={AT} onClose={() => {}} />);
    expect(screen.getByText("In sight.")).toBeTruthy();
    expect(screen.getByText("In sight now")).toBeTruthy();
    expect(screen.queryByText(/world day/)).toBeNull();
  });

  it("shows a discovered tile's base and no live section", () => {
    render(<TilePanel tile={discovered} at={AT} onClose={() => {}} />);
    expect(screen.getByText("Found, not seen by you.")).toBeTruthy();
    expect(screen.getByText("In the Cinder Reach")).toBeTruthy();
    expect(screen.queryByText("In sight now")).toBeNull();
    expect(screen.queryByText(/threat/)).toBeNull();
  });

  it("closes", () => {
    const onClose = vi.fn();
    render(<TilePanel tile={discovered} at={AT} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close the tile" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
