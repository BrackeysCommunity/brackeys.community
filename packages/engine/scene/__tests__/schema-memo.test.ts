import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { fragmentSchemaFor } from "../fragment";
import { inputScriptSchemasFor } from "../input-script";
import { sceneJsonSchema } from "../json-schema";
import { opBatchSchemaFor, sceneOpSchemaFor } from "../ops-schema";
import { prefabSchemaFor } from "../prefab";
import { builtFor, entitySchemaFor, sceneSchemaFor, spawnSchemaFor } from "../schema";
import { fakeGame } from "./fixtures/fake-game";

const spark = defineEntityType({
  type: "spark",
  description: "A flash game code makes.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it flashes."), life: z.number().int().default(3) },
});
const sparkGame = defineGame({ ...fakeGame, types: [...fakeGame.types, spark] });

describe("schemas built once per registry", () => {
  it("builds each key once for a registry, and again for another", () => {
    const a = createRegistry(fakeGame);
    const b = createRegistry(fakeGame);
    let builds = 0;
    const build = () => ({ n: ++builds });
    const first = builtFor(a, "probe", build);
    expect(builtFor(a, "probe", build)).toBe(first);
    expect(builds).toBe(1);
    expect(builtFor(a, "other", build)).not.toBe(first);
    expect(builtFor(b, "probe", build)).not.toBe(first);
    expect(builds).toBe(3);
  });

  it("hands back one scene, fragment, prefab, entity and spawn schema per registry", () => {
    const r = createRegistry(sparkGame);
    expect(sceneSchemaFor(r)).toBe(sceneSchemaFor(r));
    expect(fragmentSchemaFor(r)).toBe(fragmentSchemaFor(r));
    expect(prefabSchemaFor(r)).toBe(prefabSchemaFor(r));
    expect(entitySchemaFor(r, "door")).toBe(entitySchemaFor(r, "door"));
    expect(spawnSchemaFor(r, "spark")).toBe(spawnSchemaFor(r, "spark"));
    expect(sceneOpSchemaFor(r)).toBe(sceneOpSchemaFor(r));
    expect(opBatchSchemaFor(r)).toBe(opBatchSchemaFor(r));
    expect(inputScriptSchemasFor(r)).toBe(inputScriptSchemasFor(r));
  });

  it("keys the input-script schemas by seat limit too", () => {
    const r = createRegistry(fakeGame);
    const four = { max: 4, join: "auto" } as const;
    const solo = inputScriptSchemasFor(r);
    expect(inputScriptSchemasFor(r, four)).toBe(inputScriptSchemasFor(r, { ...four }));
    expect(inputScriptSchemasFor(r, four)).not.toBe(solo);
    expect(sceneOpSchemaFor(createRegistry(fakeGame))).not.toBe(sceneOpSchemaFor(r));
  });

  it("never shares a schema between two registries, even of one game", () => {
    const a = createRegistry(fakeGame);
    const b = createRegistry(fakeGame);
    expect(sceneSchemaFor(a)).not.toBe(sceneSchemaFor(b));
    expect(fragmentSchemaFor(a)).not.toBe(fragmentSchemaFor(b));
    expect(prefabSchemaFor(a)).not.toBe(prefabSchemaFor(b));
    expect(entitySchemaFor(a, "door")).not.toBe(entitySchemaFor(b, "door"));
    expect(spawnSchemaFor(a, "door")).not.toBe(spawnSchemaFor(b, "door"));
    expect(sceneJsonSchema(a)).toEqual(sceneJsonSchema(b));
  });

  it("keys a type's placed and spawned schemas apart, and leaves a spawn-only type out of the placed ones", () => {
    const r = createRegistry(sparkGame);
    const placed = entitySchemaFor(r, "flag")!;
    const spawned = spawnSchemaFor(r, "flag")!;
    expect(placed).not.toBe(spawned);
    const flag = { type: "flag", at: [1, 2] };
    expect(spawned.safeParse(flag).success).toBe(true);
    expect(placed.safeParse(flag).success).toBe(false);
    expect(placed.safeParse({ ...flag, id: "f" }).success).toBe(true);
    expect(entitySchemaFor(r, "spark")).toBeUndefined();
    expect(spawnSchemaFor(r, "spark")).toBeDefined();
    // The spawn-only answer is not memoized as a placed schema later reads.
    expect(entitySchemaFor(r, "spark")).toBeUndefined();
  });

  it("builds the scene's entity union from the memoized entity schemas, and the fragment over the scene's", () => {
    const r = createRegistry(fakeGame);
    const scene = sceneSchemaFor(r).shape;
    const bulk = (fragmentSchemaFor(r).shape.bulk as z.ZodOptional<z.ZodObject>).unwrap().shape;
    expect(bulk.pad).toBe(scene.pad);
    const union = (scene.entities as z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion>>).unwrap()
      .element;
    expect(union.options).toContain(entitySchemaFor(r, "door"));
  });

  it("follows what a registry was made with: its project materials", () => {
    const bare = createRegistry(fakeGame);
    const project = createRegistry(fakeGame, {
      materials: {
        "ice-sheet": { description: "Slippery.", physics: { friction: 0, restitution: 0 } },
      },
    });
    // Built for the bare registry first, so a stale memo would hand it to the project's.
    const before = JSON.stringify(sceneJsonSchema(bare));
    const after = JSON.stringify(sceneJsonSchema(project));
    expect(before).not.toContain("ice-sheet");
    expect(after).toContain("ice-sheet");
  });

  it("gives the engine's registry its own schema, without a game key", () => {
    const engine = createRegistry();
    const game = createRegistry(fakeGame);
    expect(sceneSchemaFor(engine).shape.game).toBeUndefined();
    expect(sceneSchemaFor(game).shape.game).toBeDefined();
  });
});
