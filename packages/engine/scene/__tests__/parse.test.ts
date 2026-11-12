import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineEntityType } from "../../game/define";
import { pointField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { formatScene } from "../format";
import {
  SceneParseError,
  SceneVersionError,
  entityIssues,
  locatePointer,
  parseScene,
  parseSceneOrThrow,
  pointerLines,
  suggestType,
} from "../parse";
import { entitySchemaFor, spawnSchemaFor } from "../schema";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "../types";
import { engine, engineYardText, fake, fakeGame } from "./fixtures/fake-game";

function failIssues(input: unknown, registry: Registry = engine): [SceneIssue, ...SceneIssue[]] {
  const r = parseScene(input, registry);
  if (r.ok) throw new Error("expected a failure");
  const [first, ...rest] = r.issues;
  if (!first) throw new Error("expected at least one issue");
  return [first, ...rest];
}

const base = { v: 1, name: "s", bounds: [0, 0, 100, 100] };
const game = { ...base, game: "fake" };

describe("parseScene", () => {
  it("parses engine-yard text and values", () => {
    const fromText = parseScene(engineYardText, engine);
    expect(fromText.ok).toBe(true);
    if (!fromText.ok) return;
    expect(fromText.issues).toEqual([]);
    expect(fromText.migratedFrom).toBeUndefined();
    expect(fromText.def.name).toBe("engine-yard");
    expect(fromText.def.settings).toEqual({ gravity: [0, 12] });
    expect(parseScene(JSON.parse(engineYardText), engine)).toEqual(fromText);
  });

  it("parses a gameless scene the same against any registry", () => {
    expect(parseScene(engineYardText, fake)).toEqual(parseScene(engineYardText, engine));
    const [pad] = failIssues(
      { ...base, entities: [{ id: "p", type: "pad", shape: ["box", 0, 0, 5, 5] }] },
      fake,
    );
    expect(pad.code).toBe("unknown-type");
    expect(pad.hint).toContain('"game"');
    const [mud] = failIssues({ ...base, "solid:mud": [] }, fake);
    expect(mud.code).toBe("unknown-key");
  });

  it("parses a game's scene with its types, bulk keys and settings", () => {
    const r = parseScene(
      {
        ...game,
        settings: { lives: 3 },
        "pad:mud": [["box", 5, 5, 4, 1]],
        flag: [[10, 10]],
        entities: [{ id: "d", type: "door", shape: ["box", 0, 0, 5, 5], speed: 10, opens: "z" }],
      },
      fake,
    );
    expect(r.ok).toBe(true);
  });

  it("refuses a scene for another game with unknown-game", () => {
    const [other] = failIssues({ ...base, game: "other" }, fake);
    expect(other).toMatchObject({ code: "unknown-game", path: "/game", got: '"other"' });
    const [anyGame] = failIssues(game, engine);
    expect(anyGame.code).toBe("unknown-game");
    expect(anyGame.message).toContain("engine primitives only");
    const text = `{\n  "v": 1,\n  "game": "other",\n  "name": "s",\n  "bounds": [0, 0, 1, 1]\n}\n`;
    expect(failIssues(text)[0].line).toBe(3);
    expect(failIssues({ ...base, game: 3 })[0]).toMatchObject({ code: "schema", path: "/game" });
  });

  it("suggests registered bulk keys with path and line", () => {
    const text = engineYardText.replace('"solid"', '"solidd"');
    const [issue] = failIssues(text);
    expect(issue.code).toBe("unknown-key");
    expect(issue.path).toBe("/solidd");
    expect(issue.message).toContain('did you mean "solid"?');
    expect(issue.line).toBe(text.split("\n").findIndex((l) => l.includes('"solidd"')) + 1);
    const [mud] = failIssues({ ...game, "pad:mudd": [] }, fake);
    expect(mud.message).toContain('did you mean "pad:mud"?');
  });

  it("suggests entity keys, nested keys and registered types", () => {
    const [key] = failIssues({
      ...base,
      entities: [
        {
          id: "p",
          type: "prop",
          shape: ["circle", 5, 5, 2],
          density: 1,
          restitution: 0,
          frcition: 1,
        },
      ],
    });
    expect(key.code).toBe("unknown-key");
    expect(key.path).toBe("/entities/0/frcition");
    expect(key.entityIds).toEqual(["p"]);
    expect(key.message).toContain('"friction"');

    const path = {
      pts: [
        [0, 0],
        [5, 0],
      ],
      mode: "loop",
      speed: 1,
      pausMs: 3,
    };
    const [nested] = failIssues({
      ...base,
      entities: [{ id: "f", type: "follower", shape: ["box", 0, 0, 5, 5], path }],
    });
    expect(nested.path).toBe("/entities/0/path/pausMs");
    expect(nested.message).toContain('"pauseMs"');

    const [settings] = failIssues({ ...game, settings: { livs: 3 } }, fake);
    expect(settings.path).toBe("/settings/livs");
    expect(settings.message).toContain('"lives"');

    const [type] = failIssues({
      ...base,
      entities: [{ id: "x", type: "sensr", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(type).toMatchObject({
      code: "unknown-type",
      path: "/entities/0/type",
      entityIds: ["x"],
    });
    expect(type.message).toContain('did you mean "sensor"?');
    expect(type.expected).toBe(engine.typeNames.join(" | "));

    const [door] = failIssues(
      { ...game, entities: [{ id: "x", type: "dor", shape: ["box", 0, 0, 5, 5] }] },
      fake,
    );
    expect(door.hint).toBe('Use type: "door".');
    expect(suggestType("cloud", engine)).toBeUndefined();
  });

  it("tells a leftover b that the discriminator is now type", () => {
    const [missing] = failIssues({
      ...base,
      entities: [{ id: "x", b: "solid", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(missing).toMatchObject({ code: "unknown-type", path: "/entities/0/b" });
    expect(missing.hint).toBe('Rename "b" to "type".');
    const [typo] = failIssues({
      ...base,
      entities: [{ id: "x", b: "sold", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(typo.hint).toBe('Rename "b" to "type" and use "solid".');
    const [both] = failIssues({
      ...base,
      entities: [{ id: "x", type: "solid", b: "solid", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(both).toMatchObject({ code: "unknown-key", path: "/entities/0/b" });
    expect(both.hint).toContain('now "type"');
  });

  it("maps shape and id problems to their codes", () => {
    const [shape] = failIssues({ ...base, solid: [["box", 1, 2, 3]] });
    expect(shape.code).toBe("bad-shape");
    expect(shape.path).toBe("/solid/0");
    expect(shape.entityIds).toEqual(["~solid:0"]);
    expect(shape.message).toContain("got 4 values");
    const [tag] = failIssues({
      ...base,
      entities: [{ id: "c", type: "solid", shape: ["boxx", 0, 0, 5, 5] }],
    });
    expect(tag.code).toBe("bad-shape");
    expect(tag.path).toBe("/entities/0/shape/0");
    const [only] = failIssues({ ...game, pad: [["circle", 0, 0, 5]] }, fake);
    expect(only).toMatchObject({ code: "bad-shape", path: "/pad/0/0", entityIds: ["~pad:0"] });
    expect(only.message).toContain("a pad's shape must be box");
    const [id] = failIssues({
      ...base,
      entities: [{ id: "Big Rock", type: "marker", at: [0, 0] }],
    });
    expect(id.code).toBe("bad-id");
    expect(id.path).toBe("/entities/0/id");
    expect(id.hint).toContain('"big-rock"');
    const [tagId] = failIssues({
      ...base,
      entities: [{ id: "m", type: "marker", at: [0, 0], tags: ["Spawn"] }],
    });
    expect(tagId).toMatchObject({ code: "bad-id", path: "/entities/0/tags/0" });
    const path = {
      pts: [
        [0, 0],
        [1, "x"],
      ],
      mode: "loop",
      speed: 1,
    };
    const [deep] = failIssues({
      ...base,
      entities: [{ id: "m", type: "follower", shape: ["box", 0, 0, 5, 5], path }],
    });
    expect(deep.code).toBe("schema");
    expect(deep.path).toBe("/entities/0/path/pts/1/1");
  });

  it("refuses a newer version", () => {
    const newer = SCENE_FORMAT_VERSION + 1;
    const [issue] = failIssues(engineYardText.replace(/"v": \d+/, `"v": ${newer}`));
    expect(issue.code).toBe("version-newer");
    expect(issue.line).toBe(3);
    expect(() => parseSceneOrThrow({ v: newer }, engine)).toThrow(SceneVersionError);
  });

  it("reports a JSON syntax error with its line", () => {
    const text = '{\n  "v": 1,\n  "name": "x",\n  "bounds": [0, 0, 1, 1],,\n  "solid": []\n}\n';
    const [issue] = failIssues(text);
    expect(issue.code).toBe("schema");
    expect(issue.line).toBe(4);
    expect(failIssues('{\n "a": 1,\n "b": }')[0].line).toBe(3);
  });

  it("throws SceneParseError with issues", () => {
    try {
      parseSceneOrThrow({ v: 1 }, engine);
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(SceneParseError);
      expect(e).not.toBeInstanceOf(SceneVersionError);
      expect((e as SceneParseError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("entityIssues", () => {
  it("maps one entity's failure as parseScene would, relocated", () => {
    const def = { id: "d", type: "door", shape: ["box", 0, 0, 5, 5], sped: 1 };
    const result = entitySchemaFor(fake, "door")!.safeParse(def);
    expect(result.success).toBe(false);
    const issues = entityIssues(result.error!.issues, def, (rel) => `/entities/7${rel}`, fake);
    const key = issues.find((i) => i.code === "unknown-key")!;
    expect(key.path).toBe("/entities/7/sped");
    expect(key.message).toContain('"speed"');
  });
});

describe("JSON Pointer lines", () => {
  it("locates pointers, falling back to the nearest ancestor", () => {
    const { text, lines } = formatScene(parseSceneOrThrow(engineYardText, engine));
    const scanned = pointerLines(text);
    for (const [pointer, line] of lines)
      expect([pointer, scanned.get(pointer)]).toEqual([pointer, line]);
    expect(locatePointer(text, "/entities/3/path/pts/1")).toBe(lines.get("/entities/3"));
    expect(locatePointer(text, "/entities/0/nope")).toBe(lines.get("/entities/0"));
    expect(locatePointer("{ bad", "/x")).toBeUndefined();
  });
});

describe("parseScene: grid fields", () => {
  const registry = createRegistry(testGame);
  const sceneWith = (cells: unknown) => ({
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "g",
    bounds: [0, 0, 100, 100],
    settings: { grid: { kind: "square", cell: [16, 16] } },
    entities: [{ id: "floor", type: "paint", at: [0, 0], cells }],
  });

  it("canonicalises a hand-written grid, so formatting fixes it", () => {
    const r = parseScene(
      sceneWith({ "0,0": ["1,1,1", "0*32", ""], "-1,0": ["0*30,2,2"] }),
      registry,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.def.entities![0]!.cells).toEqual({ "-1,0": ["0*30,2*2"], "0,0": ["1*3"] });
    const text = formatScene(r.def).text;
    expect(text).toContain('"-1,0": ["0*30,2*2"],');
    expect(text).toContain('"0,0": ["1*3"]');
  });

  it("reports bad rows, keys, counts and values as grid-invalid, once each, with lines", () => {
    const text = formatScene(
      sceneWith({
        "0,0": ["1*33", "2"],
        "01,0": ["1"],
        "1,0": Array(33).fill(""),
        "2,0": ["9"],
      }) as never,
    ).text;
    const issues = failIssues(text, registry);
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["grid-invalid", "/entities/0/cells/0,0/0"],
      ["grid-invalid", "/entities/0/cells/01,0"],
      ["grid-invalid", "/entities/0/cells/1,0"],
      ["grid-invalid", "/entities/0/cells/2,0/0"],
    ]);
    expect(issues.every((i) => i.entityIds[0] === "floor")).toBe(true);
    const lineOf = (needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
    expect(issues[0].line).toBe(lineOf('"0,0"'));
    expect(issues[3]?.line).toBe(lineOf('"2,0"'));
    expect(issues[3]?.message).toMatch(/9 is past this field's largest, 3/);
  });

  it("reports a grid problem the regexes allow, a run past 32 cells", () => {
    const [issue, ...rest] = failIssues(sceneWith({ "0,0": ["1*20,2*20"] }), registry);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      code: "grid-invalid",
      path: "/entities/0/cells/0,0/0",
      got: '"1*20,2*20"',
    });
  });
});

describe("spawn-only types in a scene", () => {
  const beaconDef = {
    type: "beacon",
    description: "A light game code makes.",
    base: "marker",
    fields: { at: pointField("Where it shines.") },
  } as const;
  const spawned = createRegistry({
    ...fakeGame,
    types: [...fakeGame.types, defineEntityType({ ...beaconDef, spawnOnly: true })],
  });
  const placed = createRegistry({
    ...fakeGame,
    types: [...fakeGame.types, defineEntityType(beaconDef)],
  });

  it("report unknown-type, spawned by game code only, without the name in expected", () => {
    const [issue, ...rest] = failIssues(
      { ...game, entities: [{ id: "b", type: "beacon", at: [1, 1] }] },
      spawned,
    );
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      code: "unknown-type",
      path: "/entities/0/type",
      entityIds: ["b"],
      got: '"beacon"',
    });
    expect(issue.message).toContain("spawned by game code only");
    expect(issue.expected!.split(" | ")).toContain("flag");
    expect(issue.expected!.split(" | ")).not.toContain("beacon");
    expect(issue.hint).toContain("ctx.spawn");
  });

  it("never suggest a spawn-only type", () => {
    expect(suggestType("beacan", placed)).toBe("beacon");
    expect(suggestType("beacan", spawned)).not.toBe("beacon");
    const [issue] = failIssues(
      { ...game, entities: [{ id: "b", type: "beacan", at: [1, 1] }] },
      spawned,
    );
    expect(issue.code).toBe("unknown-type");
    expect(issue.message).not.toContain("beacon");
    expect(issue.hint).not.toContain("beacon");
  });

  it("map a spawn input's failures against its spawn schema", () => {
    const input = { type: "beacon", at: [1, 1], att: 2 };
    const result = spawnSchemaFor(spawned, "beacon")!.safeParse(input);
    expect(result.success).toBe(false);
    const [issue] = entityIssues(result.error!.issues, input, (rel) => `/spawn${rel}`, spawned, {
      spawn: true,
    });
    expect(issue).toMatchObject({ code: "unknown-key", path: "/spawn/att" });
    expect(issue!.message).toContain('did you mean "at"?');
  });
});
