import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { loadCompatRapier } from "../../scene/rapier-compat";
import {
  formatReference,
  REFERENCE_END,
  REFERENCE_START,
  withReference,
} from "../format-reference";

/**
 * Keeps `src/engine/README.md` honest: the format reference is the
 * generator's output, and every `ts` block is a file in `examples/` that `vp
 * check` type-checks against the engine's public entries. After changing
 * either on purpose, run `UPDATE_README=1 vp test run scripts/engine-readme`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const README = join(REPO, "src/engine/README.md");
const EXAMPLES = join(HERE, "../examples");
const update = process.env.UPDATE_README === "1";

/**
 * The text with what the formatter changes taken out: table padding, rule
 * widths and escapes. The README is formatted like any other file, so the
 * generator's raw output is compared in this form.
 */
const normalize = (text: string) =>
  text
    .replace(/\\([*_])/g, "$1")
    .replace(/-{3,}/g, "---")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\| ?/g, "|")
    .trim();

const section = (readme: string) =>
  readme.slice(
    readme.indexOf(REFERENCE_START) + REFERENCE_START.length,
    readme.indexOf(REFERENCE_END),
  );

type Block = { lang: string; name: string | undefined; body: string };

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const m of markdown.matchAll(/^```(\w+)(?:[ \t]+(\S+))?\n([\s\S]*?)^```$/gm)) {
    out.push({ lang: m[1]!, name: m[2], body: m[3]! });
  }
  return out;
}

describe("the engine README", () => {
  it("has the generated scene format reference", () => {
    const readme = readFileSync(README, "utf8");
    expect(readme.indexOf(REFERENCE_START)).toBeLessThan(readme.indexOf(REFERENCE_END));
    const reference = formatReference();
    if (update && normalize(section(readme)) !== normalize(reference)) {
      writeFileSync(README, withReference(readme, reference));
      spawnSync("vp", ["fmt", README], { cwd: REPO });
    }
    expect(normalize(section(readFileSync(README, "utf8")))).toBe(normalize(reference));
  });

  it("names every ts block, and each is a file in examples/", () => {
    const ts = blocks(readFileSync(README, "utf8")).filter((b) => b.lang === "ts");
    expect(ts.length).toBeGreaterThan(0);
    const unnamed = ts.filter((b) => !b.name?.endsWith(".ts"));
    expect(
      unnamed.map((b) => b.body.split("\n")[0]),
      "every ts block needs a file name",
    ).toEqual([]);
    const names = ts.map((b) => b.name!);
    expect(new Set(names).size, "block names must be unique").toBe(names.length);

    if (update) {
      if (existsSync(EXAMPLES)) rmSync(EXAMPLES, { recursive: true });
      mkdirSync(EXAMPLES, { recursive: true });
      for (const b of ts) writeFileSync(join(EXAMPLES, b.name!), b.body);
    }
    expect(readdirSync(EXAMPLES).sort()).toEqual([...names].sort());
    for (const b of ts) {
      expect(readFileSync(join(EXAMPLES, b.name!), "utf8"), b.name).toBe(b.body);
    }
  });
});

describe("the world-model examples run", () => {
  it("grid-tools.ts paths round the rocks, floods a field and casts sight", async () => {
    const { scout } = await import("../examples/grid-tools");
    const r = scout();
    expect(r.steps).toBeGreaterThan(8);
    expect(r.cost).toBe(r.steps! * 10);
    expect(r.fromCorner).toBeGreaterThan(0);
    expect(r.nextFromCorner).toBeDefined();
    expect(r.seesAcross).toBe(false);
    expect(r.clearShot).toBe(true);
  });

  it("shape-queries.ts finds what a blade cuts and where a laser lands, exactly", async () => {
    const { workbench } = await import("../examples/shape-queries");
    const cut = workbench({ type: "circle", cx: 300, cy: 60, r: 5 }, [200, 100]);
    expect(cut.upright).toEqual({ minX: 295, minY: 60, maxX: 305, maxY: 140 });
    expect(cut.near).toEqual(["upright"]);
    expect(cut.cuts).toEqual(["upright"]);
    expect(cut.laser).toEqual({ at: 295, normal: [-1, 0] });
    const both = workbench(
      { type: "box", cx: 200, cy: 100, hw: 100, hh: 2, rotDeg: 0 },
      [200, 300],
    );
    expect(both.near).toEqual(["flat", "upright"]);
    expect(both.cuts).toEqual(["flat", "upright"]);
    expect(both.laser).toBeNull();
    const corner = workbench({ type: "circle", cx: 309, cy: 144, r: 5 }, [200, 100]);
    expect(corner.near).toEqual(["upright"]);
    expect(corner.cuts).toEqual([]);
  });

  it("nav-walk.ts walks round the table and through the doorway", async () => {
    const { walkAround } = await import("../examples/nav-walk");
    const r = walkAround();
    expect(r.issues).toEqual([]);
    expect(r.path?.[0]).toEqual([100, 150]);
    expect(r.path?.at(-1)).toEqual([650, 150]);
    expect(r.path!.length).toBeGreaterThan(2);
    expect(r.onTable).toBe(false);
    expect(r.clickedOutside).toEqual([550, 200]);
  });

  it("orchard-game.ts catches up eight hours of a day away", async () => {
    const { dayAway } = await import("../examples/orchard-game");
    expect(dayAway().final).toEqual({ trees: 2, ripe: 0, picked: 2 * 8 * 60 });
  });

  it("balloon-type.ts is physics-required in a scene without physics", async () => {
    const { balloonIssues } = await import("../examples/balloon-type");
    expect(balloonIssues()).toEqual(["physics-required"]);
  });

  it("rover-game.ts drives home on both backends", async () => {
    const { driveHome } = await import("../examples/rover-game");
    expect(driveHome(null).result).toBe("won");
    expect(driveHome(await loadCompatRapier()).result).toBe("won");
  });

  it("walker-playtest.ts wins, replays, skips idle slots and never loads Rapier", async () => {
    const { walkCorridor } = await import("../examples/walker-playtest");
    let loaded = false;
    const r = await walkCorridor(async () => {
      loaded = true;
      return loadCompatRapier();
    });
    expect(loaded).toBe(false);
    expect(r.result).toBe("won");
    expect(r.replayed).toBe(true);
    expect(r.ticks).toBeLessThan(r.slots);
    expect(r.commands.map((c) => c[1])).toEqual(["walk", "walk"]);
  });
});
