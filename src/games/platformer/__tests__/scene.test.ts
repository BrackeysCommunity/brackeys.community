// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { runProbe } from "@jams/engine/headless";
import {
  createRegistry,
  createScene,
  expandScene,
  formatScene,
  inputScriptJsonSchema,
  parseScene,
  sceneJsonSchema,
  undescribedProperties,
  validateScene,
  type SceneDefinition,
} from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";

const registry = createRegistry(platformerGame);
const SCHEMA = new URL("../scene.schema.json", import.meta.url);
const SCRIPT_SCHEMA = new URL("../input-script.schema.json", import.meta.url);
const text = readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8");

let def: SceneDefinition;

beforeAll(() => {
  const parsed = parseScene(text, registry);
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  def = parsed.def;
});

describe("test-yard.json", () => {
  it("is canonical: formatScene writes it back byte for byte", () => {
    expect(formatScene(def).text).toBe(text);
  });

  it("names the platformer and its schema", () => {
    expect(def.game).toBe("platformer");
    expect(def.$schema).toBe("../scene.schema.json");
  });

  it("has no validation errors or warnings", () => {
    expect(validateScene(def, registry).filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("expands in the platformer's spawn order, the spawn marker last", () => {
    const types = expandScene(def, registry).entities.map((e) => e.type);
    const order = ["solid", "cloud", "goal", "exit", "hazard", "prop", "mover", "anchor", "spawn"];
    expect([...new Set(types)]).toEqual(order);
  });

  it("moves right and lands on an entity id when move_right is held", async () => {
    const scene = expandScene(def, registry);
    const report = runProbe({
      rapier: await import("@dimforge/rapier2d"),
      game: platformerGame,
      registry,
      scene,
      ticks: 120,
      hold: ["move_right"],
    });
    expect(report.load.ok).toBe(true);
    expect(report.final!.position.x).toBeGreaterThan(960);
    const landed = report.events.find((e) => e.type === "landed");
    expect(scene.entities.map((e) => e.id)).toContain(landed?.entityId);
  });
});

describe("the new-scene template", () => {
  it("parses, is canonical and validates clean", () => {
    const fresh = createScene("fresh", registry);
    expect(fresh.game).toBe("platformer");
    const parsed = parseScene(formatScene(fresh).text, registry);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    if (parsed.ok) expect(validateScene(parsed.def, registry)).toEqual([]);
  });
});

describe("scene.schema.json", () => {
  it("matches sceneJsonSchema for the platformer (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = sceneJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA, "utf8"))).toEqual(fresh);
  });

  it("has the platformer's URN id", () => {
    expect(sceneJsonSchema(registry).$id).toBe("urn:jams-engine:scene:platformer:v2");
  });
});

describe("input-script.schema.json", () => {
  it("matches inputScriptJsonSchema for the platformer (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = inputScriptJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCRIPT_SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCRIPT_SCHEMA, "utf8"))).toEqual(fresh);
  });

  it("has the platformer's URN id and describes every property", () => {
    const schema = inputScriptJsonSchema(registry);
    expect(schema.$id).toBe("urn:jams-engine:input-script:platformer:v1");
    expect(undescribedProperties(schema)).toEqual([]);
  });
});
