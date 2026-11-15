// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { SYNTH_PRESETS, synthDurationMs } from "@jams/engine/headless";
import { parseAssetDoc, synthKind, type SynthFile } from "@jams/engine/project";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { synthNew, synthRender } from "../tools/synth";
import { tempProject } from "./fixtures";

let root: string;

const contextFor = async (name: string): Promise<ToolContext> => ({
  projects: [await tempProject(join(root, name), { id: name })],
  loadRapier: loadCompatRapier,
});

/** Every file under `dir` but the project file, with its text, by relative path. */
async function files(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "jams.project.json") continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = await readFile(path, "utf8");
  }
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-synth-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("synth new", { timeout: 60_000 }, () => {
  it("writes the same bytes for the same seed, a valid patch, and nothing with --dry-run", async () => {
    const first = await contextFor("one");
    const second = await contextFor("two");
    const a = await synthNew({ preset: "pickup", seed: "7" }, first);
    const b = await synthNew({ preset: "pickup", seed: "7" }, second);
    expect(a.exitCode, a.text).toBe(0);
    expect(b.exitCode, b.text).toBe(0);
    expect(a.data).toMatchObject({
      written: true,
      preset: "pickup",
      seed: 7,
      created: ["synth-1"],
    });
    const one = await files(join(root, "one"));
    const two = await files(join(root, "two"));
    expect(Object.keys(one)).toContain("synth-1.json");
    expect(one["synth-1.json"]).toBe(two["synth-1.json"]);

    const patch = JSON.parse(one["synth-1.json"]!) as SynthFile;
    expect(patch.kind).toBe("synth");
    const env = { registry: first.projects[0]!.registry };
    expect(parseAssetDoc(synthKind, patch, env as never).ok).toBe(true);

    const other = await synthNew({ preset: "pickup", seed: "8", id: "other" }, first);
    expect(other.exitCode, other.text).toBe(0);
    const both = await files(join(root, "one"));
    expect(both["other.json"]).not.toBe(both["synth-1.json"]);

    const dry = await contextFor("dry");
    const before = await files(join(root, "dry"));
    const trial = await synthNew({ preset: "pickup", seed: "7", dryRun: true }, dry);
    expect(trial.exitCode, trial.text).toBe(0);
    expect(trial.data).toMatchObject({ written: false, dryRun: true });
    expect(await files(join(root, "dry"))).toEqual(before);
  });

  it("writes to --path, a file or a folder", async () => {
    const ctx = await contextFor("paths");
    const file = await synthNew({ preset: "blip", seed: "1", path: "sfx/beep.json" }, ctx);
    expect(file.exitCode, file.text).toBe(0);
    const folder = await synthNew({ preset: "hit", seed: "2", id: "thud", path: "sfx/" }, ctx);
    expect(folder.exitCode, folder.text).toBe(0);
    expect(Object.keys(await files(join(root, "paths")))).toEqual(
      expect.arrayContaining(["sfx/beep.json", "sfx/thud.json"]),
    );
  });

  it("refuses an unknown preset with the list of presets, and a bad seed", async () => {
    const ctx = await contextFor("refused");
    const before = await files(join(root, "refused"));
    const unknown = await synthNew({ preset: "pickp", seed: "1" }, ctx);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.text).toContain('did you mean "pickup"');
    for (const preset of SYNTH_PRESETS) expect(unknown.text).toContain(preset);
    const seed = await synthNew({ preset: "jump", seed: "-1" }, ctx);
    expect(seed.exitCode).toBe(2);
    expect(seed.text).toContain("--seed");
    expect(await files(join(root, "refused"))).toEqual(before);
  });
});

describe("synth render", { timeout: 60_000 }, () => {
  it("writes a WAV whose header gives the patch's duration", async () => {
    const ctx = await contextFor("render");
    expect((await synthNew({ preset: "laser", seed: "3", id: "zap" }, ctx)).exitCode).toBe(0);
    const patch = JSON.parse(await readFile(join(root, "render", "zap.json"), "utf8")) as SynthFile;
    const wav = join(root, "zap.wav");
    const result = await synthRender({ id: "zap", wav }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    const bytes = new Uint8Array(await readFile(wav));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    const channels = view.getUint16(22, true);
    const rate = view.getUint32(24, true);
    const bits = view.getUint16(34, true);
    const frames = view.getUint32(40, true) / channels / (bits / 8);
    expect(channels).toBe(1);
    expect(bits).toBe(16);
    expect(Math.round((frames / rate) * 1000)).toBe(synthDurationMs(patch));
    expect(result.data).toMatchObject({ durationMs: synthDurationMs(patch), bytes: bytes.length });
  });

  it("refuses an id that isn't a patch or isn't there", async () => {
    const ctx = await contextFor("missing");
    const missing = await synthRender({ id: "nope", wav: join(root, "x.wav") }, ctx);
    expect(missing.exitCode).toBe(1);
    expect((await synthRender({ id: "nope" }, ctx)).exitCode).toBe(2);
  });
});
