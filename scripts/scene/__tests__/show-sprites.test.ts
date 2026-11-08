// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const FIXTURES = fileURLToPath(
  new URL("../../../src/engine/project/__tests__/fixtures", import.meta.url),
);

let root: string;
let ctx: ToolContext;

type Data = Record<string, unknown>;
type Row = { ref: string; sprite?: { label: string; size: number[]; aabb: Data } };

async function run(...argv: string[]) {
  const r = await runCli([...argv, "--json"], ctx);
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Data };
}

const gallery = {
  v: 3,
  name: "gallery",
  bounds: [0, 0, 400, 200],
  groups: { turned: { at: [300, 100], rot: 1 } },
  entities: [
    { id: "pic", type: "marker", at: [100, 100], behaviors: { sprite: { asset: "tex" } } },
    {
      id: "gem",
      type: "marker",
      at: [200, 100],
      behaviors: { sprite: { asset: "items", frame: "gem.png" } },
    },
    {
      id: "box",
      type: "prop",
      shape: ["box", 50, 150, 8, 8],
      density: 1,
      restitution: 0,
      behaviors: { sprite: {} },
    },
    {
      id: "flag",
      type: "marker",
      group: "turned",
      at: [0, 0],
      behaviors: { sprite: { size: [10, 40], anchor: [0.5, 1] } },
    },
    { id: "plain", type: "marker", at: [20, 20] },
  ],
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-show-sprites-"));
  const dir = join(root, "deck");
  await mkdir(dir);
  await writeFile(join(dir, "gallery.json"), `${JSON.stringify(gallery, null, 2)}\n`);
  ctx = { projects: [await tempProject(dir, { id: "deck" })], loadRapier: loadCompatRapier };
  for (const argv of [
    ["assets", "import", join(FIXTURES, "texture.png"), "--path", "art/", "--id", "tex"],
    ["assets", "import", join(FIXTURES, "items.png"), "--path", "art/", "--id", "items-art"],
    ["assets", "import", join(FIXTURES, "items.json"), "--path", "art/"],
  ]) {
    const r = await run(...argv);
    if (r.exitCode !== 0) throw new Error(JSON.stringify(r.data));
  }
  await writeFile(join(root, "loose.json"), `${JSON.stringify(gallery)}\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const spriteOf = (rows: Row[], ref: string) => rows.find((r) => r.ref === ref)?.sprite;

describe("show: sprite boxes", { timeout: 60_000 }, () => {
  it("lists each sprite's world box, sized from the project's asset info", async () => {
    const r = await run("show", "gallery");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    const rows = r.data.entities as Row[];
    // The texture's 12×10 about its centre.
    expect(spriteOf(rows, "pic")).toEqual({
      label: "tex",
      asset: "tex",
      size: [12, 10],
      aabb: { minX: 94, minY: 95, maxX: 106, maxY: 105 },
    });
    // The atlas frame's 8×8 at its bottom-centre pivot.
    expect(spriteOf(rows, "gem")).toMatchObject({
      label: "items:gem.png",
      frame: "gem.png",
      size: [8, 8],
      aabb: { minX: 196, minY: 92, maxX: 204, maxY: 100 },
    });
    // No asset: the 32×32 fallback at the body's centre.
    expect(spriteOf(rows, "box")).toEqual({
      label: "(no asset)",
      size: [32, 32],
      aabb: { minX: 34, minY: 134, maxX: 66, maxY: 166 },
    });
    // A quarter turn of its group turns the sprite with the point: it lies to the right of it.
    expect(spriteOf(rows, "flag")?.aabb).toEqual({ minX: 300, minY: 95, maxX: 340, maxY: 105 });
    expect(spriteOf(rows, "plain")).toBeUndefined();
  });

  it("prints each sprite's label and box", async () => {
    const text = (await runCli(["show", "gallery", "--ref", "pic"], ctx)).stdout;
    expect(text).toContain("pic  marker at 100,100 behaviors sprite sprite tex 94,95..106,105");
  });

  it("falls back to the block's size or 32×32 for a file outside every project", async () => {
    const r = await run("show", join(root, "loose.json"));
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(spriteOf(r.data.entities as Row[], "pic")).toMatchObject({
      size: [32, 32],
      aabb: { minX: 84, minY: 84, maxX: 116, maxY: 116 },
    });
  });

  it("render sizes the same boxes from the project", async () => {
    const r = await run("render", "gallery");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(r.data.sprites).toContainEqual({
      ref: "gem",
      type: "marker",
      label: "items:gem.png",
      box: { minX: 196, minY: 92, maxX: 204, maxY: 100 },
    });
    expect(r.data.svg).toContain(">items:gem.png</text>");
  });
});
