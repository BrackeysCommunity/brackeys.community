import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import {
  fragmentJsonSchema,
  prefabJsonSchema,
  SCHEMA_ID_BASE,
  undescribedProperties,
} from "../json-schema";
import { parsePrefab } from "../prefab";
import { engine, fake } from "./fixtures/fake-game";

const FRAGMENT_FILE = new URL("../fragment.schema.json", import.meta.url);
const PREFAB_FILE = new URL("../prefab.schema.json", import.meta.url);

const contracted = createRegistry(
  defineGame({
    id: "chunks",
    types: [],
    actions: [],
    prefabContract: {
      exits: z
        .array(z.enum(["left", "right"]))
        .describe("Which sides a run can leave by.")
        .meta({ title: "Exits" }),
    },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

describe("fragment.schema.json and prefab.schema.json", () => {
  for (const [file, make, name] of [
    [FRAGMENT_FILE, fragmentJsonSchema, "fragment"],
    [PREFAB_FILE, prefabJsonSchema, "prefab"],
  ] as const) {
    it(`${name}: matches the engine-only registry's schema (UPDATE_SCHEMAS=1 regenerates)`, () => {
      const fresh = make(engine);
      if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(fresh);
    });

    it(`${name}: has a URN id per game, the agent surface version, and describes every field`, () => {
      const schema = make(engine);
      expect(schema.$id).toBe(`${SCHEMA_ID_BASE}${name}:v2`);
      expect(make(fake).$id).toBe(`${SCHEMA_ID_BASE}${name}:fake:v2`);
      expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
      expect(undescribedProperties(schema)).toEqual([]);
    });
  }
});

describe("the prefab contract slot", () => {
  const prefab = { kind: "prefab", v: 2, id: "chunk", entities: [] };

  it("refuses a contract when the game declares none", () => {
    const r = parsePrefab({ ...prefab, contract: { exits: ["left"] } }, engine);
    expect(r.ok).toBe(false);
    expect(parsePrefab(prefab, engine).ok).toBe(true);
  });

  it("checks a contract against the game's fields", () => {
    const game = { ...prefab, game: "chunks" };
    const good = parsePrefab({ ...game, contract: { exits: ["left", "right"] } }, contracted);
    expect(good.ok && good.prefab.contract).toEqual({ exits: ["left", "right"] });
    const bad = parsePrefab({ ...game, contract: { exits: ["up"] } }, contracted);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]!.path).toBe("/contract/exits/0");
    const extra = parsePrefab({ ...game, contract: { exits: [], margin: 4 } }, contracted);
    expect(!extra.ok && extra.issues[0]!.code).toBe("unknown-key");
  });

  it("puts the game's contract fields in the prefab schema", () => {
    const schema = prefabJsonSchema(contracted) as {
      properties: { contract: { properties?: Record<string, unknown> } };
    };
    expect(Object.keys(schema.properties.contract.properties ?? {})).toEqual(["exits"]);
  });
});
