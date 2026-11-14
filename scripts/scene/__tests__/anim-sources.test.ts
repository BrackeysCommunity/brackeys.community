// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { check } from "../tools/check";
import { list } from "../tools/list";
import { validate } from "../tools/validate";
import { tempProject } from "./fixtures";

const ENGINE_SCENES = fileURLToPath(new URL("../../../packages/engine/scenes", import.meta.url));
const STD_ANIM = '"anim": { "clip": "idle", "source": "kitchen-animation" }';
const HERO_SPRITE = '"sprite": { "asset": "hero", "frame": "hero-0"';

let root: string;

/** A copy of the engine project whose kitchen sink has `edit` applied to its text. */
async function sinkWith(name: string, edit: (text: string) => string): Promise<ToolContext> {
  const dir = join(root, name);
  await cp(ENGINE_SCENES, dir, { recursive: true });
  const file = join(dir, "kitchen-sink.json");
  const text = await readFile(file, "utf8");
  const edited = edit(text);
  expect(edited).not.toBe(text);
  await writeFile(file, edited);
  return { projects: [await tempProject(dir, { id: name })], loadRapier: loadCompatRapier };
}

const codesOf = (data: unknown) =>
  (data as { issues: { code: string }[] }).issues.map((i) => i.code);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-anim-sources-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("an anim block whose source is an animation", { timeout: 60_000 }, () => {
  it("validate, list and the valid check report a clip the animation lacks", async () => {
    const ctx = await sinkWith("typo", (t) =>
      t.replace(STD_ANIM, STD_ANIM.replace("idle", "idel")),
    );
    const validated = await validate({ target: "kitchen-sink" }, ctx);
    expect(validated.exitCode).toBe(1);
    expect(codesOf(validated.data)).toEqual(["anim-clip-unknown"]);
    expect(validated.text).toContain('animation "kitchen-animation" doesn\'t have');

    const listed = await list({}, ctx);
    const sink = (
      listed.data as { scenes: { name: string; issues: { error: number } }[] }
    ).scenes.find((s) => s.name === "kitchen-sink");
    expect(sink?.issues.error).toBe(1);

    const checked = await check({ scene: "kitchen-sink", only: "valid" }, ctx);
    expect(checked.exitCode).toBe(1);
    expect(checked.text).toContain("anim-clip-unknown");
  });

  it("validate reports a sprite drawn from an atlas without the animation's frames", async () => {
    const ctx = await sinkWith("mismatch", (t) =>
      t.replace(
        `${STD_ANIM}, ${HERO_SPRITE}`,
        `${STD_ANIM}, "sprite": { "asset": "crates", "frame": "crate-0"`,
      ),
    );
    const validated = await validate({ target: "kitchen-sink" }, ctx);
    expect(codesOf(validated.data)).toEqual(["anim-atlas-mismatch"]);
  });
});
