import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { formatScene } from "../format";
import {
  SceneParseError,
  SceneVersionError,
  locatePointer,
  parseScene,
  parseSceneOrThrow,
  pointerLines,
} from "../parse";

const yardText = readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8");

function failIssues(input: unknown) {
  const r = parseScene(input);
  if (r.ok) throw new Error("expected a failure");
  return r.issues;
}

describe("parseScene", () => {
  it("parses test-yard text and values", () => {
    const fromText = parseScene(yardText);
    expect(fromText.ok).toBe(true);
    if (!fromText.ok) return;
    expect(fromText.issues).toEqual([]);
    expect(fromText.migratedFrom).toBeUndefined();
    expect(fromText.def.name).toBe("test-yard");
    expect(parseScene(JSON.parse(yardText))).toEqual(fromText);
  });

  it("suggests solid:ice for solid:icee with path and line", () => {
    const text = yardText.replace('"solid:ice"', '"solid:icee"');
    const [issue] = failIssues(text);
    expect(issue.code).toBe("unknown-key");
    expect(issue.path).toBe("/solid:icee");
    expect(issue.message).toContain('did you mean "solid:ice"?');
    expect(issue.line).toBe(text.split("\n").findIndex((l) => l.includes('"solid:icee"')) + 1);
  });

  it("suggests entity keys and behaviors", () => {
    const base = { v: 1, name: "s", bounds: [0, 0, 100, 100], spawn: [[50, 50]] };
    const [key] = failIssues({
      ...base,
      entities: [
        { id: "p", b: "prop", shape: ["circle", 5, 5, 2], density: 1, restitution: 0, frcition: 1 },
      ],
    });
    expect(key.code).toBe("unknown-key");
    expect(key.path).toBe("/entities/0/frcition");
    expect(key.entityIds).toEqual(["p"]);
    expect(key.message).toContain('"friction"');

    const [b] = failIssues({
      ...base,
      entities: [{ id: "x", b: "platfrom", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(b.code).toBe("schema");
    expect(b.path).toBe("/entities/0/b");
    expect(b.message).toContain('did you mean "mover"?');
    const [sens] = failIssues({
      ...base,
      entities: [{ id: "x", b: "sensr", kind: "goal", shape: ["box", 0, 0, 5, 5] }],
    });
    expect(sens.message).toContain('"sensor"');
  });

  it("maps shape and id problems to their codes", () => {
    const base = { v: 1, name: "s", bounds: [0, 0, 100, 100], spawn: [[50, 50]] };
    const [shape] = failIssues({ ...base, solid: [["box", 1, 2, 3]] });
    expect(shape.code).toBe("bad-shape");
    expect(shape.path).toBe("/solid/0");
    expect(shape.entityIds).toEqual(["~solid:0"]);
    expect(shape.message).toContain("got 4 values");
    const [tag] = failIssues({
      ...base,
      entities: [{ id: "c", b: "cloud", shape: ["boxx", 0, 0, 5, 5] }],
    });
    expect(tag.code).toBe("bad-shape");
    expect(tag.path).toBe("/entities/0/shape/0");
    const [id] = failIssues({ ...base, entities: [{ id: "Big Rock", b: "anchor", at: [0, 0] }] });
    expect(id.code).toBe("bad-id");
    expect(id.path).toBe("/entities/0/id");
    expect(id.hint).toContain('"big-rock"');
    const [deep] = failIssues({
      ...base,
      entities: [
        {
          id: "m",
          b: "mover",
          shape: ["box", 0, 0, 5, 5],
          path: {
            pts: [
              [0, 0],
              [1, "x"],
            ],
            mode: "loop",
            speed: 1,
          },
        },
      ],
    });
    expect(deep.code).toBe("schema");
    expect(deep.path).toBe("/entities/0/path/pts/1/1");
  });

  it("refuses a newer version", () => {
    const [issue] = failIssues(yardText.replace('"v": 1', '"v": 2'));
    expect(issue.code).toBe("version-newer");
    expect(issue.line).toBe(3);
    expect(() => parseSceneOrThrow({ v: 2 })).toThrow(SceneVersionError);
  });

  it("reports a JSON syntax error with its line", () => {
    const text = '{\n  "v": 1,\n  "name": "x",\n  "bounds": [0, 0, 1, 1],,\n  "spawn": []\n}\n';
    const [issue] = failIssues(text);
    expect(issue.code).toBe("schema");
    expect(issue.line).toBe(4);
    expect(failIssues('{\n "a": 1,\n "b": }')[0].line).toBe(3);
  });

  it("throws SceneParseError with issues", () => {
    try {
      parseSceneOrThrow({ v: 1 });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(SceneParseError);
      expect(e).not.toBeInstanceOf(SceneVersionError);
      expect((e as SceneParseError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("JSON Pointer lines", () => {
  it("locates pointers, falling back to the nearest ancestor", () => {
    const { text, lines } = formatScene(parseSceneOrThrow(yardText));
    const scanned = pointerLines(text);
    for (const [pointer, line] of lines)
      expect([pointer, scanned.get(pointer)]).toEqual([pointer, line]);
    expect(locatePointer(text, "/entities/0/path/pts/1")).toBe(lines.get("/entities/0"));
    expect(locatePointer(text, "/entities/0/nope")).toBe(lines.get("/entities/0"));
    expect(locatePointer("{ bad", "/x")).toBeUndefined();
  });
});
