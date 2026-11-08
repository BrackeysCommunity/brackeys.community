import { describe, expect, it } from "vite-plus/test";

import { randomKey } from "../../collab/keys";
import { DOC_NAME_MAX_LENGTH, docNameOf, parseDocName, type DocName } from "../doc-names";

const id48 = `a${"b".repeat(47)}`;

describe("doc names", () => {
  it("parses the three forms", () => {
    expect(parseDocName("project:platformer")).toEqual({ kind: "project", project: "platformer" });
    expect(parseDocName("scene:platformer.tutorial")).toEqual({
      kind: "scene",
      project: "platformer",
      key: "tutorial",
    });
    expect(parseDocName("asset:engine.post")).toEqual({
      kind: "asset",
      project: "engine",
      key: "post",
    });
  });

  it("round-trips through docNameOf", () => {
    const refs: DocName[] = [
      { kind: "project", project: "engine" },
      { kind: "project", project: id48 },
      { kind: "scene", project: "platformer", key: "level-1" },
      { kind: "scene", project: id48, key: id48 },
      { kind: "asset", project: "engine", key: randomKey() },
      { kind: "asset", project: id48, key: id48 },
    ];
    for (const ref of refs) {
      const name = docNameOf(ref);
      expect(name.length).toBeLessThanOrEqual(DOC_NAME_MAX_LENGTH[ref.kind]);
      expect(parseDocName(name)).toEqual(ref);
    }
  });

  it("fits the longest ids exactly in each kind's limit", () => {
    expect(docNameOf({ kind: "project", project: id48 })).toHaveLength(56);
    expect(docNameOf({ kind: "scene", project: id48, key: id48 })).toHaveLength(103);
    expect(docNameOf({ kind: "asset", project: id48, key: id48 })).toHaveLength(103);
  });

  it("keeps today's hosted scene names", () => {
    expect(parseDocName("scene:platformer.engine-yard")).toMatchObject({
      project: "platformer",
      key: "engine-yard",
    });
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "project:",
      "project:a.b",
      "project:Platformer",
      `project:${id48}x`,
      "scene:platformer",
      "scene:.tutorial",
      "scene:platformer.",
      "scene:platformer.a.b",
      "scene:platformer.Tutorial",
      `scene:${id48}.${id48}x`,
      "asset:engine:post",
      "canvas:abc",
      "note:engine.post",
      "scene:engine-yard",
      " scene:engine.post",
      "scene:engine.post ",
      "scene:-engine.post",
    ]) {
      expect(parseDocName(bad), bad).toBeNull();
    }
  });

  it("refuses to name a doc with a bad id or key", () => {
    expect(() => docNameOf({ kind: "project", project: "Bad" })).toThrow(/project id/);
    expect(() => docNameOf({ kind: "scene", project: "engine", key: "a.b" })).toThrow(/key/);
    expect(() => docNameOf({ kind: "asset", project: "engine", key: "" })).toThrow(/key/);
  });
});
