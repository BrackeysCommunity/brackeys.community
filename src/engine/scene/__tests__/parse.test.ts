import { describe, expect, it } from "vite-plus/test";

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
import { entitySchemaFor } from "../schema";
import type { SceneIssue } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

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
    expect(fromText.def.settings).toEqual({ gravity: [0, 1200] });
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
    const [issue] = failIssues(engineYardText.replace('"v": 2', '"v": 3'));
    expect(issue.code).toBe("version-newer");
    expect(issue.line).toBe(3);
    expect(() => parseSceneOrThrow({ v: 3 }, engine)).toThrow(SceneVersionError);
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
