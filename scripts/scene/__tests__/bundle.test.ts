// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

const ENGINE_SCENES = fileURLToPath(new URL("../../../packages/engine/scenes", import.meta.url));
const FIXTURES = fileURLToPath(
  new URL("../../../packages/engine/project/__tests__/fixtures", import.meta.url),
);

let root: string;
let deck: string;
let ctx: ToolContext;

type Data = Record<string, unknown>;

async function run(...argv: string[]) {
  const r = await runCli([...argv, "--json"], ctx);
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Data };
}

/** Rewrites a scene file's `assets` header in the temp copy. */
async function setHeader(file: string, assets: string[]) {
  const path = join(deck, file);
  const json = JSON.parse(await readFile(path, "utf8")) as Data;
  await writeFile(path, `${JSON.stringify({ ...json, assets })}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-bundle-"));
  deck = join(root, "deck");
  await cp(ENGINE_SCENES, deck, { recursive: true });
  ctx = { projects: [await tempProject(deck, { id: "deck" })], loadRapier: loadCompatRapier };
  const art = ["--path", "imported/"];
  for (const argv of [
    ["assets", "import", join(FIXTURES, "items.png"), ...art, "--id", "items-art"],
    ["assets", "import", join(FIXTURES, "items.json"), ...art],
    ["assets", "import", join(FIXTURES, "hero.png"), ...art, "--id", "hero-art"],
  ]) {
    const r = await run(...argv);
    if (r.exitCode !== 0) throw new Error(JSON.stringify(r.data));
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("bundle", { timeout: 60_000 }, () => {
  it("lists the textures a scene's header and its prefabs' headers reach, an atlas giving its texture", async () => {
    await setHeader("kitchen-sink.json", ["cards", "items"]);
    await setHeader("prefabs/latch.json", ["hero-art"]);
    const r = await run("bundle", "kitchen-sink");
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    const bundle = r.data.bundle as { entries: { id: string; kind: string; bytes: number }[] };
    // The sink's own sprites bring its three textures; the headers add the imported two.
    expect(bundle.entries.map((e) => [e.id, e.kind])).toEqual([
      ["backdrop", "texture"],
      ["crates-texture", "texture"],
      ["hero-art", "texture"],
      ["hero-texture", "texture"],
      ["items-art", "texture"],
    ]);
    expect(r.data).toMatchObject({
      ok: true,
      scene: "kitchen-sink",
      issues: [],
      bundle: { name: "kitchen-sink", bytes: bundle.entries.reduce((sum, e) => sum + e.bytes, 0) },
    });
    const text = await runCli(["bundle", "kitchen-sink"], ctx);
    expect(text.stdout).toMatch(
      /^kitchen-sink: 5 blobs, \d+ B\n {2}backdrop {2}texture {2}[0-9a-f]{64} {2}\d+ B/,
    );
  });

  it("exits 1 with asset-missing and a did-you-mean for a dangling id", async () => {
    await setHeader("engine-yard.json", ["item"]);
    const r = await run("bundle", "engine-yard");
    expect(r.exitCode).toBe(1);
    expect(r.data).toMatchObject({
      ok: false,
      bundle: { entries: [], bytes: 0 },
      issues: [{ code: "asset-missing", path: "/assets/0", got: "item" }],
    });
    expect(String((r.data.issues as { message: string }[])[0]!.message)).toMatch(
      /did you mean "items"\?/,
    );
    const text = await runCli(["bundle", "engine-yard"], ctx);
    expect(text.stderr).toContain("asset-missing");
  });

  it("exits 2 without a scene and 1 for one outside every project", async () => {
    expect((await run("bundle")).exitCode).toBe(2);
    const outside = join(root, "loose.json");
    await writeFile(outside, await readFile(join(deck, "engine-yard.json"), "utf8"));
    const r = await run("bundle", outside);
    expect(r.exitCode).toBe(1);
    expect(String(r.data.error)).toMatch(/isn't in a project/);
  });
});
