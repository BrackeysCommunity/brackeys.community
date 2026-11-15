// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistry, defineGame, type DebugDraw } from "@jams/engine/game";
import { runProbe, type RapierModule } from "@jams/engine/headless";
import { expandScene, SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { noopDebugDrawProblem } from "../../engine-bundle-check";
import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { rasterizeSvg } from "../raster";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Draws a green line at x = its tick in metres and its tick as text, each step, while something shows them. */
const drawingGame = defineGame({
  id: "debug-drawing",
  types: [],
  actions: [],
  createRuntime(run) {
    let tick = 0;
    return {
      beforeStep() {
        tick++;
        if (!run.debug.active) return;
        run.debug.line({ x: tick, y: 0 }, { x: tick, y: 4 }, { color: 0x00ff00, width: 6 });
        run.debug.text({ x: tick, y: 5 }, `tick ${tick}`);
      },
      snapshot: () => ({ tick }),
    };
  },
});

let root: string;
let ctx: ToolContext;
let stdin = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-render-"));
  const dirs = {
    engine: join(root, "engine"),
    platformer: join(root, "platformer"),
    drawing: join(root, "drawing"),
  };
  await mkdir(dirs.engine);
  await mkdir(dirs.platformer);
  await mkdir(dirs.drawing);
  await writeFile(
    join(dirs.drawing, "draws.json"),
    `${JSON.stringify({ v: SCENE_FORMAT_VERSION, game: drawingGame.id, name: "draws", bounds: [0, 0, 10, 6], settings: { physics: "none" }, entities: [] })}\n`,
  );
  await copyFile(
    repoFile("packages/engine/scenes/engine-yard.json"),
    join(dirs.engine, "engine-yard.json"),
  );
  await copyFile(
    repoFile("packages/engine/scene/__tests__/fixtures/sprites.json"),
    join(dirs.engine, "sprites.json"),
  );
  await copyFile(
    repoFile("src/games/platformer/scenes/test-yard.json"),
    join(dirs.platformer, "test-yard.json"),
  );
  ctx = {
    projects: [
      await tempProject(dirs.engine, { id: "engine" }),
      await tempProject(dirs.platformer, { game: platformerGame }),
      await tempProject(dirs.drawing, { game: drawingGame }),
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

describe("scene render --debug-draw", () => {
  it("runs the ticks and draws the last tick's ctx.debug shapes in the SVG", async () => {
    const r = await runCli(["render", "draws", "--debug-draw", "--ticks", "3", "--json"], ctx);
    expect(r.exitCode, r.stderr).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.debugDraw).toEqual({ ticks: 3, draws: 2 });
    expect(data.svg).toMatch(/data-debug="line" d="M300 0L300 400" fill="none" stroke="#00ff00"/);
    expect(data.svg).toContain(">tick 3</text>");
    expect(data.svg).not.toContain('d="M200 0L200 400"');
  });

  it("draws nothing extra without the flag", async () => {
    const r = await runCli(["render", "draws"], ctx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("debug-draw");
  });

  it("draws them in the PNG", async () => {
    const out = join(root, "draws.png");
    const r = await runCli(["render", "draws", "--debug-draw", "--ticks", "2", "--out", out], ctx);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("2 debug draws after 2 ticks");
    const plain = await rasterizeSvg((await runCli(["render", "draws"], ctx)).stdout);
    const drawn = await rasterizeSvg(
      JSON.parse(
        (await runCli(["render", "draws", "--debug-draw", "--ticks", "2", "--json"], ctx)).stdout,
      ).svg,
    );
    const green = (pixels: Uint8Array) => {
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i]! < 60 && pixels[i + 1]! > 200 && pixels[i + 2]! < 60) n++;
      return n;
    };
    expect(green(plain.pixels)).toBe(0);
    expect(green(drawn.pixels)).toBeGreaterThan(50);
  });

  it("refuses --ticks without --debug-draw, a bad count and --ascii", async () => {
    const noFlag = await runCli(["render", "draws", "--ticks", "3"], ctx);
    expect(noFlag.exitCode).toBe(2);
    expect(noFlag.stderr).toContain("--ticks needs --debug-draw");
    const bad = await runCli(["render", "draws", "--debug-draw", "--ticks", "0"], ctx);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("--ticks must be an integer");
    const ascii = await runCli(["render", "draws", "--debug-draw", "--ascii"], ctx);
    expect(ascii.exitCode).toBe(2);
    expect(ascii.stderr).toContain("--debug-draw is for images");
  });
});

describe("the production ctx.debug check", () => {
  /** The `ctx.debug` game code sees in a headless run, with or without a collector. */
  const debugOf = (collectDebugDraw: boolean) => {
    let seen: DebugDraw | null = null;
    runProbe({
      rapier: null,
      game: drawingGame,
      scene: expandScene(
        {
          v: SCENE_FORMAT_VERSION,
          name: "d",
          bounds: [0, 0, 1, 1],
          settings: { physics: "none" },
          entities: [],
        },
        createRegistry(drawingGame),
      ),
      ticks: 1,
      collectDebugDraw,
      onTick: (_tick, run) => {
        seen = run.debug;
      },
    });
    return seen!;
  };

  it("accepts the frozen no-op and refuses an active or unfrozen draw", () => {
    const noop = debugOf(false);
    expect(noopDebugDrawProblem(noop)).toBeNull();
    expect(noopDebugDrawProblem(debugOf(true))).toBe("ctx.debug is active");
    expect(noopDebugDrawProblem({ ...noop })).toBe("ctx.debug isn't frozen");
  });
});

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
    expect(r.stdout).toContain("region 16.4,5.92,17.6,9.08 m");
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
    expect(json.legend).toContainEqual({ char: "=", label: "cloud one-way" });

    const region = await runCli(["render", "test-yard", "--ascii", "--region", "14,9,18,12"], ctx);
    expect(region.stdout).toContain("x 1344..1856");
  });

  it("draws a playtest report's overlay (in metres) from a file or stdin", async () => {
    const report = {
      blocked: false,
      trail: {
        every: 4,
        pts: [
          [3, 9.4],
          [8.8, 9.3],
        ],
        truncated: false,
      },
      events: [{ tick: 3, type: "sensor:enter", entityId: "zone", at: { x: 8.8, y: 9.3 } }],
      outcome: { result: "won", tick: 90, at: { x: 8.8, y: 9.3 } },
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

  it("labels each sprite's box with its asset and frame, and lists the boxes", async () => {
    const svg = (await runCli(["render", "sprites"], ctx)).stdout;
    expect(svg).toContain('data-sprite="hero" data-asset="hero-sheet" data-frame="idle-0"');
    expect(svg).toContain(">hero-sheet:idle-0</text>");
    expect(svg).toContain(">(no asset)</text>");

    const json = JSON.parse((await runCli(["render", "sprites", "--json"], ctx)).stdout);
    expect(json.sprites).toHaveLength(5);
    expect(json.sprites).toContainEqual({
      ref: "lamp",
      type: "marker",
      label: "lamp",
      box: { minX: 3.08, minY: 2.24, maxX: 3.32, maxY: 2.88 },
    });
    const yardJson = JSON.parse((await runCli(["render", "engine-yard", "--json"], ctx)).stdout);
    expect(yardJson).not.toHaveProperty("sprites");

    const ascii = JSON.parse(
      (await runCli(["render", "sprites", "--ascii", "--json", "--around", "tree"], ctx)).stdout,
    );
    expect(ascii.sprites.map((s: { ref: string }) => s.ref)).toContain("tree");
    expect(ascii.lines.join("")).toContain("+");
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
