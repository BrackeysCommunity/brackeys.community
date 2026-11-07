// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { textconv } from "../tools/textconv";

const ENGINE_YARD = fileURLToPath(
  new URL("../../../src/engine/scenes/engine-yard.json", import.meta.url),
);
const ctx = {} as ToolContext;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scene-textconv-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function conv(text: string) {
  const file = join(dir, "tmp-scene.json");
  await writeFile(file, text);
  return textconv({ file }, ctx);
}

describe("scene textconv", () => {
  it("lists the header, settings, bulk entries and entities one per line", async () => {
    const r = await conv(
      JSON.stringify({
        entities: [
          { type: "sensor", id: "zone", tags: ["goal"], shape: ["box", 9, 9, 4, 4] },
          { id: "start", type: "marker" },
        ],
        name: "t",
        v: 1,
        settings: { wind: 2, gravity: [0, 900] },
        bounds: [0, 0, 100, 100],
        peg: [[3, 4]],
        solid: [
          ["box", 50, 95, 50, 5],
          ["circle", 10, 10, 3],
        ],
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.text).toBe(
      [
        "v: 1",
        'name: "t"',
        "bounds: [0, 0, 100, 100]",
        "settings.gravity: [0, 900]",
        "settings.wind: 2",
        "~peg:0 [3 4]",
        "~solid:0 [box 50 95 50 5]",
        "~solid:1 [circle 10 10 3]",
        'zone sensor { "shape": ["box", 9, 9, 4, 4], "tags": ["goal"] }',
        "start marker",
      ].join("\n"),
    );
  });

  it("shows one moved bulk entry as one changed line", async () => {
    const text = await readFile(ENGINE_YARD, "utf8");
    const before = (await conv(text)).text.split("\n");
    const doc = JSON.parse(text) as { solid: number[][] };
    doc.solid[1]![1]! += 8;
    const after = (await conv(JSON.stringify(doc))).text.split("\n");
    const changed = after.filter((line, i) => line !== before[i]);
    expect(after).toHaveLength(before.length);
    expect(changed).toEqual([expect.stringMatching(/^~solid:1 \[box /)]);
  });

  it("passes text that isn't a scene through unchanged", async () => {
    for (const text of ['{ "v": 1, "entities": [', '{ "checks": [] }\n', "[1, 2]\n", ""]) {
      const r = await conv(text);
      expect(r.exitCode).toBe(0);
      expect(`${r.text}\n`).toBe(text.endsWith("\n") ? text : `${text}\n`);
    }
  });

  it("fails on a file it can't read and asks for one when none is given", async () => {
    expect((await textconv({ file: join(dir, "missing.json") }, ctx)).exitCode).toBe(1);
    expect((await textconv({}, ctx)).exitCode).toBe(2);
  });
});
