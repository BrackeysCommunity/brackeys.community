import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultIconPng } from "@jams/engine/export";

import { runCli } from "../../commands";
import type { ToolContext } from "../../context";

/** The animation the menu's banner plays: the units atlas's "blue" tag as the clip "march". */
export const MOTION_ANIMATION = "units-march";
/** The emitter preset the menu's dust cloud sprays, drawing the "tile-rubble" texture. */
export const MOTION_PRESET = "dust";
/** An emitter preset no entity names, the only asset that names the texture `MOTION_SPARE_TEXTURE`. */
export const MOTION_SPARE_PRESET = "spark-spray";
export const MOTION_SPARE_TEXTURE = "spark";

/**
 * Adds an animation and emitter presets to the tactics project `ctx`
 * holds, through the scene CLI as an author would: the animation
 * `MOTION_ANIMATION` over the units atlas, the presets `MOTION_PRESET` and
 * `MOTION_SPARE_PRESET` (with its own texture), and on the start scene
 * ("menu") a banner playing the animation and a dust cloud spraying
 * `MOTION_PRESET`. `staging` holds the imported files' sources. Throws on
 * any command that fails.
 */
export async function addMotion(ctx: ToolContext, staging: string): Promise<void> {
  await mkdir(staging, { recursive: true });
  const cli = async (...argv: string[]) => {
    const r = await runCli([...argv, "--project", "tactics", "--json"], ctx);
    if (r.exitCode !== 0) throw new Error(`${argv.join(" ")}\n${r.stdout}\n${r.stderr}`);
  };
  const stage = async (name: string, content: string | Uint8Array) => {
    const path = join(staging, name);
    await writeFile(path, content);
    return path;
  };
  const doc = (json: object) => `${JSON.stringify(json, null, 2)}\n`;

  await cli(
    "assets",
    "import",
    await stage("spark.png", defaultIconPng(192)),
    "--path",
    "art/",
    "--id",
    MOTION_SPARE_TEXTURE,
  );
  const licence = {
    v: 1,
    label: "License the spark",
    ops: [
      {
        op: "setLicence",
        id: MOTION_SPARE_TEXTURE,
        licence: { spdx: "CC0-1.0", author: "The @jams/engine authors" },
      },
    ],
  };
  await cli("assets", "apply", "--ops", await stage("licence-ops.json", doc(licence)));
  const docs: [string, string, object][] = [
    [
      "units-march.animation.json",
      MOTION_ANIMATION,
      { kind: "animation", v: 1, atlas: "units", clips: [{ name: "march", tag: "blue" }] },
    ],
    [
      "dust.emitter.json",
      MOTION_PRESET,
      {
        kind: "emitter",
        v: 1,
        texture: "tile-rubble",
        rate: 8,
        lifeMs: [300, 600],
        speed: [0.2, 0.6],
        angle: [-150, -30],
      },
    ],
    [
      "spark-spray.emitter.json",
      MOTION_SPARE_PRESET,
      {
        kind: "emitter",
        v: 1,
        texture: MOTION_SPARE_TEXTURE,
        rate: 0,
        bursts: [{ atMs: 0, count: 12 }],
        lifeMs: [200, 400],
        speed: [1, 2],
        angle: [0, 360],
      },
    ],
  ];
  for (const [name, id, json] of docs)
    await cli("assets", "import", await stage(name, doc(json)), "--path", "art/", "--id", id);

  const ops = {
    label: "A marching banner and a dust cloud on the menu",
    ops: [
      {
        op: "add",
        entity: {
          id: "banner",
          type: "decor",
          layer: "decor",
          at: [6, 6],
          behaviors: {
            sprite: { asset: "units", frame: "knight-blue", size: [1, 1] },
            anim: { source: MOTION_ANIMATION, clip: "march" },
          },
        },
      },
      {
        op: "add",
        entity: {
          id: "dust-cloud",
          type: "decor",
          layer: "decor",
          at: [6, 7],
          behaviors: { emitter: { preset: MOTION_PRESET } },
        },
      },
    ],
  };
  await cli("apply", "menu", "--ops", await stage("menu-ops.json", doc(ops)));
}
