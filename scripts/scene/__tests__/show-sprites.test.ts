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
  new URL("../../../packages/engine/project/__tests__/fixtures", import.meta.url),
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
  v: 4,
  name: "gallery",
  bounds: [0, 0, 4, 2],
  groups: { turned: { at: [3, 1], rot: 1 } },
  entities: [
    { id: "pic", type: "marker", at: [1, 1], behaviors: { sprite: { asset: "tex" } } },
    {
      id: "gem",
      type: "marker",
      at: [2, 1],
      behaviors: { sprite: { asset: "items", frame: "gem.png" } },
    },
    {
      id: "box",
      type: "prop",
      shape: ["box", 0.5, 1.5, 0.08, 0.08],
      density: 1,
      restitution: 0,
      behaviors: { sprite: {} },
    },
    {
      id: "flag",
      type: "marker",
      group: "turned",
      at: [0, 0],
      behaviors: { sprite: { size: [0.1, 0.4], anchor: [0.5, 1] } },
    },
    { id: "plain", type: "marker", at: [0.2, 0.2] },
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
      size: [0.12, 0.1],
      aabb: { minX: 0.94, minY: 0.95, maxX: 1.06, maxY: 1.05 },
    });
    // The atlas frame's 8×8 at its bottom-centre pivot.
    expect(spriteOf(rows, "gem")).toMatchObject({
      label: "items:gem.png",
      frame: "gem.png",
      size: [0.08, 0.08],
      aabb: { minX: 1.96, minY: 0.92, maxX: 2.04, maxY: 1 },
    });
    // No asset: the 0.32 × 0.32 m fallback at the body's centre.
    expect(spriteOf(rows, "box")).toEqual({
      label: "(no asset)",
      size: [0.32, 0.32],
      aabb: { minX: 0.34, minY: 1.34, maxX: 0.66, maxY: 1.66 },
    });
    // A quarter turn of its group turns the sprite with the point: it lies to the right of it.
    expect(spriteOf(rows, "flag")?.aabb).toEqual({ minX: 3, minY: 0.95, maxX: 3.4, maxY: 1.05 });
    expect(spriteOf(rows, "plain")).toBeUndefined();
  });

  it("prints each sprite's label and box", async () => {
    const text = (await runCli(["show", "gallery", "--ref", "pic"], ctx)).stdout;
    expect(text).toContain(
      "pic  marker at 1,1 m behaviors sprite sprite tex 0.94,0.95..1.06,1.05 m",
    );
  });

  it("falls back to the block's size or 0.32 × 0.32 m for a file outside every project", async () => {
    const r = await run("show", join(root, "loose.json"));
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(spriteOf(r.data.entities as Row[], "pic")).toMatchObject({
      size: [0.32, 0.32],
      aabb: { minX: 0.84, minY: 0.84, maxX: 1.16, maxY: 1.16 },
    });
  });

  it("render sizes the same boxes from the project", async () => {
    const r = await run("render", "gallery");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(r.data.sprites).toContainEqual({
      ref: "gem",
      type: "marker",
      label: "items:gem.png",
      box: { minX: 1.96, minY: 0.92, maxX: 2.04, maxY: 1 },
    });
    expect(r.data.svg).toContain(">items:gem.png</text>");
  });
});
