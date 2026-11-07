import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { ENGINE_YARD_EXPANDED } from "../../__tests__/fixtures/engine-yard.expanded";
import { generateScene } from "../../__tests__/fixtures/generate-scene";
import { createRegistry, defineEntityType, defineGame, RegistryError } from "../../game/define";
import { primitiveFields } from "../../game/primitives";
import { renderSceneAscii, sceneAsciiMap } from "../ascii";
import { parseSceneOrThrow } from "../parse";
import type { SceneDefinition } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);
const golden = new URL("./engine-yard.golden.txt", import.meta.url);

const legendOf = (map: { legend: { char: string; label: string }[] }) =>
  Object.fromEntries(map.legend.map((l) => [l.char, l.label]));

describe("renderSceneAscii", () => {
  it("matches the golden map of engine-yard (UPDATE_GOLDENS=1 regenerates)", () => {
    const text = renderSceneAscii(yard, { registry: engine });
    if (process.env.UPDATE_GOLDENS) writeFileSync(golden, text);
    expect(text).toBe(readFileSync(golden, "utf8"));
    expect(renderSceneAscii(ENGINE_YARD_EXPANDED, { registry: engine })).toBe(text);
  });

  it("puts each entity in its cells: solids, one-way, paths, tags and points", () => {
    const map = sceneAsciiMap(yard, { registry: engine });
    expect([map.cols, map.rows, map.cell]).toEqual([32, 16, 64]);
    const at = (x: number, y: number) => map.lines[Math.floor(y / 64)]![Math.floor(x / 64)];
    expect(at(1000, 980)).toBe("#");
    expect(at(1400, 800)).toBe("=");
    expect(at(1700, 700)).toBe("~");
    expect(at(1700, 900)).toBe("F");
    expect(at(900, 930)).toBe("G");
    expect(at(300, 960)).toBe("S");
    expect(at(1200, 940)).toBe("p");
    expect(at(600, 500)).toBe(".");
    expect(legendOf(map)).toEqual({
      "#": "solid",
      "~": "path",
      "=": "solid one-way",
      F: "follower",
      p: "prop",
      G: "sensor [goal]",
      S: "marker [spawn]",
    });
  });

  it("takes its characters from the types: the type's own, its base's, else its first letter", () => {
    const def: SceneDefinition = {
      v: 1,
      game: "fake",
      name: "fake-yard",
      bounds: [0, 0, 512, 128],
      pad: [["box", 32, 32, 30, 30]],
      flag: [[96, 32]],
      entities: [
        { id: "b", type: "button", shape: ["box", 160, 32, 30, 30] },
        { id: "d", type: "door", shape: ["box", 224, 32, 30, 30], speed: 1 },
        { id: "t", type: "button", shape: ["box", 288, 32, 30, 30], tags: ["hazard"] },
      ],
    };
    const map = sceneAsciiMap(def, { registry: fake });
    expect(map.lines[0]).toBe("#+sdx...");
    expect(legendOf(map)).toEqual({
      "#": "pad",
      "+": "flag",
      s: "button",
      d: "door",
      x: "button [hazard]",
    });
    expect(sceneAsciiMap(def, { registry: fake, tagChars: {} }).lines[0]).toBe("#+sds...");

    const game = defineGame({
      id: "lettered",
      types: [
        defineEntityType({
          type: "lava",
          description: "Lava.",
          base: "sensor",
          fields: (env) => primitiveFields("sensor", env),
          ascii: "~",
        }),
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const lettered = {
      ...def,
      game: "lettered",
      pad: undefined,
      flag: undefined,
      entities: [{ id: "l", type: "lava", shape: ["box", 32, 32, 30, 30] }],
    } as SceneDefinition;
    expect(sceneAsciiMap(lettered, { registry: createRegistry(game) }).lines[0]).toBe("~.......");
  });

  it("rejects a type whose ascii isn't one printable character", () => {
    const bad = (ascii: string) =>
      createRegistry(
        defineGame({
          id: "bad",
          types: [
            defineEntityType({
              type: "blob",
              description: "A blob.",
              base: "marker",
              fields: (env) => primitiveFields("marker", env),
              ascii,
            }),
          ],
          actions: [],
          createRuntime: () => ({ snapshot: () => null }),
        }),
      );
    expect(() => bad("ab")).toThrow(RegistryError);
    expect(() => bad(" ")).toThrow(/one printable ASCII character/);
    expect(() => bad("b")).not.toThrow();
  });

  it("frames a region or an entity on cell lines, with spaces outside the scene", () => {
    const map = sceneAsciiMap(yard, { registry: engine, around: "lift" });
    expect(map.region).toEqual([1472, 448, 1920, 1088]);
    expect(map.lines.at(-1)).toBe("       ");
    expect(map.lines.at(-2)).toBe("#######");
    const region = sceneAsciiMap(yard, { registry: engine, region: [-100, 900, 330, 1000] });
    expect(region.region).toEqual([-128, 896, 384, 1024]);
    expect(region.lines).toEqual(["  #...p.", "  ####S#"]);
  });

  it("grows its cells in steps of 64 to stay within maxCells", () => {
    const huge: SceneDefinition = { ...generateScene(2), bounds: [0, 0, 100_000, 10_000] };
    const map = sceneAsciiMap(huge, { registry: engine });
    expect(map.cell).toBe(512);
    expect(map.cols).toBeLessThanOrEqual(200);
    expect(sceneAsciiMap(huge, { registry: engine, maxCells: 50 }).cell).toBe(2048);
  });

  it("marks a playtest's trail and outcome", () => {
    const map = sceneAsciiMap(yard, {
      registry: engine,
      overlay: {
        trail: {
          pts: [
            [300, 700],
            [700, 700],
          ],
        },
        outcome: { result: "won", at: { x: 700, y: 700 } },
      },
    });
    expect(map.lines[10]).toBe("#...******!...............~...##");
    expect(legendOf(map)).toMatchObject({ "*": "trail", "!": "outcome won" });
  });
});
