// @vitest-environment node
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSaveFile } from "@jams/engine/game";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { save } from "../tools/save";
import { tempProject } from "./fixtures";

const GRID_YARD = fileURLToPath(
  new URL("../../../src/engine/scenes/grid-yard.json", import.meta.url),
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
    for (const now of ["-1", "soon", "1.5"]) {
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
