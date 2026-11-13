// @vitest-environment node
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineGame, parseSaveFile, SLOT_MAX_LENGTH, SLOT_RULE } from "@jams/engine/game";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { ToolContext } from "../context";
import { save } from "../tools/save";
import { tempProject } from "./fixtures";

const GRID_YARD = fileURLToPath(
  new URL("../../../packages/engine/scenes/grid-yard.json", import.meta.url),
);

let root: string;
let dir: string;
let ctx: ToolContext;
let script: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "save-fixtures-"));
  dir = join(root, "yard");
  const project = await tempProject(dir, { id: "yard" });
  await copyFile(GRID_YARD, join(dir, "grid-yard.json"));
  ctx = {
    projects: [project],
    loadRapier: () => Promise.reject(new Error("grid-yard has no physics")),
  };
  script = join(root, "wait.json");
  await writeFile(script, JSON.stringify({ v: 2, seed: 1, steps: [{ wait: 20 }] }));
});

afterAll(() => rm(root, { recursive: true, force: true }));

const savedAt = async (file: string) => {
  const parsed = parseSaveFile(await readFile(file, "utf8"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.file.meta.savedAt;
};

describe("scene save", { timeout: 60_000 }, () => {
  it("writes the same bytes for the same run: savedAt is 0 unless --now names it", async () => {
    const [a, b, c] = ["a", "b", "c"].map((slot) => join(root, "out", `${slot}.save.json`));
    for (const out of [a!, b!]) {
      const r = await save({ scene: "grid-yard", script, at: "10", out }, ctx);
      expect(r.exitCode, r.text).toBe(0);
    }
    const text = (f: string) => readFile(f, "utf8");
    expect((await text(a!)).replace('"slot": "a"', "")).toBe(
      (await text(b!)).replace('"slot": "b"', ""),
    );
    expect(await savedAt(a!)).toBe(0);
    const stamped = await save({ scene: "grid-yard", script, at: "10", out: c!, now: "5" }, ctx);
    expect(stamped.exitCode, stamped.text).toBe(0);
    expect(await savedAt(c!)).toBe(5);
    for (const now of ["-1", "soon", "1.5", "", " 5", "1e3"]) {
      const bad = await save({ scene: "grid-yard", script, at: "10", out: c!, now }, ctx);
      expect(bad.exitCode, now).toBe(2);
    }
  });

  it("imports a fixture under the asset globs, and writes a test fixture as a plain file", async () => {
    const asset = join(dir, "saves", "yard.save.json");
    const imported = await save({ scene: "grid-yard", script, at: "10", out: asset }, ctx);
    expect(imported.exitCode, imported.text).toBe(0);
    expect(imported.data).toMatchObject({ project: "yard" });
    expect(existsSync(`${asset}.asset.json`)).toBe(true);

    const fixture = join(dir, "__tests__", "fixtures", "yard.save.json");
    const plain = await save({ scene: "grid-yard", script, at: "10", out: fixture }, ctx);
    expect(plain.exitCode, plain.text).toBe(0);
    expect(plain.data).toMatchObject({ project: null });
    expect(existsSync(fixture)).toBe(true);
    expect(existsSync(`${fixture}.asset.json`)).toBe(false);
  });
});

type Visits = { visits: number };

/**
 * A physics-free game of two rooms: holding `down` in the hall asks for the
 * cellar at its stairs, counting the visit in the persistent value.
 */
const cellarGame = defineGame<{ ticks: number }>({
  id: "cellar",
  types: [],
  actions: [{ action: "down", keys: ["s"], description: "Takes the stairs down." }],
  world: { physics: "none" },
  persist: {
    initial: () => ({ visits: 0 }),
    schema: z.strictObject({ visits: z.number().int().min(0) }),
  },
  createRuntime(ctx) {
    let ticks = 0;
    return {
      onLoad() {
        ticks = 0;
      },
      beforeStep() {
        ticks++;
        if (ctx.flow.scene !== "cellar" && ctx.input.held("down")) {
          const { visits } = ctx.persist.value as Visits;
          ctx.flow.request({ to: "cellar", entry: "stairs", persist: { visits: visits + 1 } });
        }
      },
      snapshot: () => ({ ticks }),
      restore(saved) {
        ticks = saved.ticks;
      },
    };
  },
});

const room = (name: string) =>
  JSON.stringify({
    v: SCENE_FORMAT_VERSION,
    name,
    game: cellarGame.id,
    bounds: [0, 0, 4, 4],
    settings: { physics: "none" },
    entities: [{ id: "stairs", type: "marker", at: [1, 1] }],
  });

describe("scene save --flow", { timeout: 60_000 }, () => {
  let flowCtx: ToolContext;
  let down: string;

  beforeAll(async () => {
    const house = join(root, "cellar");
    await mkdir(join(house, "scenes"), { recursive: true });
    await writeFile(join(house, "scenes", "hall.json"), room("hall"));
    await writeFile(join(house, "scenes", "cellar.json"), room("cellar"));
    await writeFile(
      join(house, "scene-list.json"),
      JSON.stringify({
        kind: "scene-list",
        v: 1,
        start: "hall",
        scenes: [{ scene: "hall" }, { scene: "cellar" }],
      }),
    );
    flowCtx = { ...ctx, projects: [await tempProject(house, { game: cellarGame })] };
    down = join(root, "down.json");
    await writeFile(
      down,
      JSON.stringify({
        v: 1,
        seed: 1,
        steps: [{ hold: ["down"], for: 1 }, { wait: 20 }],
      }),
    );
  });

  it("follows the run into the next scene and saves its entry and persist there", async () => {
    const out = join(root, "out", "below.save.json");
    const r = await save({ scene: "hall", script: down, at: "8", out, flow: true }, flowCtx);
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({ scene: "cellar", entry: "stairs", depth: "world", tick: 8 });
    const parsed = parseSaveFile(await readFile(out, "utf8"), cellarGame);
    expect(parsed.ok && parsed.file).toMatchObject({
      scene: { id: "cellar", entry: "stairs" },
      persist: { visits: 1 },
      meta: { playTicks: 8 },
      data: { ticks: 7 },
    });
  });

  it("saves nothing without --flow, where the request ends the run first", async () => {
    const out = join(root, "out", "never.save.json");
    const r = await save({ scene: "hall", script: down, at: "8", out }, flowCtx);
    expect(r.exitCode, r.text).toBe(1);
    expect(r.text).toContain("ended as flow");
    expect(existsSync(out)).toBe(false);
  });

  it("names the slot rule as SLOT_RULE words it", async () => {
    const slot = "a".repeat(SLOT_MAX_LENGTH + 1);
    const out = join(root, "out", `${slot}.save.json`);
    const r = await save({ scene: "grid-yard", script, at: "5", out }, ctx);
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain(`${SLOT_RULE}; got "${slot}"`);
    expect(existsSync(out)).toBe(false);
  });

  it("needs a project with a scene list", async () => {
    const out = join(root, "out", "yard.save.json");
    const r = await save({ scene: "grid-yard", script, at: "5", out, flow: true }, ctx);
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("has no scene list");
  });
});
