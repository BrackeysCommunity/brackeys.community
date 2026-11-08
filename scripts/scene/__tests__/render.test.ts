// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RapierModule } from "@jams/engine/headless";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { rasterizeSvg } from "../raster";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

let root: string;
let ctx: ToolContext;
let stdin = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-render-"));
  const dirs = { engine: join(root, "engine"), platformer: join(root, "platformer") };
  await mkdir(dirs.engine);
  await mkdir(dirs.platformer);
  await copyFile(
    repoFile("src/engine/scenes/engine-yard.json"),
    join(dirs.engine, "engine-yard.json"),
  );
  await copyFile(
    repoFile("src/games/platformer/scenes/test-yard.json"),
    join(dirs.platformer, "test-yard.json"),
  );
  ctx = {
    projects: [
      await tempProject(dirs.engine, { id: "engine" }),
      await tempProject(dirs.platformer, { game: platformerGame }),
    ],
    loadRapier: () => import("@dimforge/rapier2d") as Promise<RapierModule>,
    readStdin: async () => stdin,
  };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

const distinctColors = (pixels: Uint8Array) => {
  const seen = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    seen.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
    if (seen.size > 50) break;
  }
  return seen.size;
};

describe("scene render", () => {
  it("writes a PNG of the expected size that isn't blank", async () => {
    const out = join(root, "yard.png");
    const r = await runCli(["render", "test-yard", "--out", out, "--json"], ctx);
    expect(r.exitCode, r.stderr).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data).toMatchObject({ ok: true, format: "png", width: 1600, height: 453, tick: 256 });
    const png = new Uint8Array(await readFile(out));
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(pngSize(png)).toEqual([1600, 453]);
    const raster = await rasterizeSvg((await runCli(["render", "test-yard"], ctx)).stdout);
    expect([raster.width, raster.height]).toEqual([1600, 453]);
    expect(distinctColors(raster.pixels)).toBeGreaterThan(20);
  });

  it("prints the SVG without --out and writes it with an .svg --out", async () => {
    const printed = await runCli(
      ["render", "engine-yard", "--labels", "all", "--scale", "0.5"],
      ctx,
    );
    expect(printed.exitCode).toBe(0);
    expect(printed.stdout).toMatch(/^<svg [^>]*width="1000" height="500"/);
    expect(printed.stdout).toContain(">~solid:0</text>");

    const out = join(root, "lift.svg");
    const r = await runCli(
      ["render", "engine-yard", "--around", "lift", "--margin", "0", "--out", out],
      ctx,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("region 1640,592,1760,908");
    expect(await readFile(out, "utf8")).toContain('data-path="lift"');
  });

  it("prints the ASCII map with --ascii", async () => {
    const r = await runCli(["render", "engine-yard", "--ascii"], ctx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("engine-yard: x 0..2048, y 0..1024, 64px cells (32 x 16)");
    expect(r.stdout).toContain("960 ####S###########################");
    expect(r.stdout).toContain("  G  sensor [goal]");

    const json = JSON.parse(
      (await runCli(["render", "test-yard", "--ascii", "--json"], ctx)).stdout,
    );
    expect(json).toMatchObject({ ok: true, scene: "test-yard", cell: 64, cols: 95, rows: 27 });
    expect(json.legend).toContainEqual({ char: "=", label: "cloud" });

    const region = await runCli(
      ["render", "test-yard", "--ascii", "--region", "1400,900,1800,1200"],
      ctx,
    );
    expect(region.stdout).toContain("x 1344..1856");
  });

  it("draws a playtest report's overlay from a file or stdin", async () => {
    const report = {
      blocked: false,
      trail: {
        every: 4,
        pts: [
          [300, 940],
          [880, 930],
        ],
        truncated: false,
      },
      events: [{ tick: 3, type: "sensor:enter", entityId: "zone", at: { x: 880, y: 930 } }],
      outcome: { result: "won", tick: 90, at: { x: 880, y: 930 } },
      issues: [],
    };
    const file = join(root, "report.json");
    await writeFile(file, JSON.stringify(report));
    const svg = (await runCli(["render", "engine-yard", "--overlay", file], ctx)).stdout;
    expect(svg).toContain('<g id="trail">');
    expect(svg).toContain('data-result="won"');
    stdin = JSON.stringify(report);
    const ascii = await runCli(["render", "engine-yard", "--ascii", "--overlay", "-"], ctx);
    expect(ascii.stdout).toContain("!  outcome won");
  });

  it("exits 2 on bad flags", async () => {
    const bad = async (...argv: string[]) => (await runCli(["render", ...argv], ctx)).exitCode;
    expect(await bad("engine-yard", "--out", "x.gif")).toBe(2);
    expect(await bad("engine-yard", "--region", "0,0,10")).toBe(2);
    expect(await bad("engine-yard", "--labels", "some")).toBe(2);
    expect(await bad("engine-yard", "--scale", "0")).toBe(2);
    expect(await bad("engine-yard", "--margin", "10")).toBe(2);
    expect(await bad("engine-yard", "--ascii", "--out", "x.png")).toBe(2);
    expect(await bad("engine-yard", "--around", "lifft")).toBe(2);
    expect(await bad("engine-yard", "--overlay", join(root, "missing.json"))).toBe(2);
    expect(await bad()).toBe(2);
  });
});
