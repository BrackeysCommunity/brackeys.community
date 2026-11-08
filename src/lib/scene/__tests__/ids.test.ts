import { ID_PATTERN } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { documentProject, MAX_ID_LENGTH, parseDocumentName } from "../../canvas/sync-channels";
import { isSceneId, parseSceneId, sceneGame } from "../ids";

describe("hosted scene ids", () => {
  it("are <project>.<key>, each an engine id", () => {
    expect(parseSceneId("platformer.level-1")).toMatchObject({
      project: "platformer",
      key: "level-1",
    });
    expect(parseSceneId("engine.yard")).toMatchObject({ project: "engine", key: "yard" });
    for (const bad of [
      "level-1",
      "Platformer.level",
      "a.b.c",
      ".x",
      "x.",
      "a.-b",
      "a:b.c",
      `a.${"x".repeat(49)}`,
      7,
    ]) {
      expect(isSceneId(bad)).toBe(false);
    }
    expect(ID_PATTERN.test(`${"x".repeat(48)}`)).toBe(true);
    expect(isSceneId(`${"g".repeat(48)}.${"n".repeat(48)}`)).toBe(true);
  });

  it("keep a scene hosted before projects under its name, with its game as the project", () => {
    expect(parseSceneId("platformer.level-1")).toEqual({
      project: "platformer",
      key: "level-1",
    });
  });

  it("make a document name the service parses, of the scene's project", () => {
    const id = `${"g".repeat(48)}.${"n".repeat(48)}`;
    expect(id.length).toBeLessThanOrEqual(MAX_ID_LENGTH);
    expect(parseDocumentName(`scene:${id}`)).toEqual({ kind: "scene", id });
    expect(documentProject(`scene:${id}`)).toBe("g".repeat(48));
  });

  it("name no game for the engine's primitives", () => {
    expect(sceneGame(parseSceneId("engine.yard")!)).toBeUndefined();
    expect(sceneGame(parseSceneId("platformer.yard")!)).toBe("platformer");
  });
});
