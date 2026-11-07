import { ID_PATTERN } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { parseDocumentName } from "../../canvas/sync-channels";
import { isSceneId, parseSceneId, sceneGame } from "../ids";

describe("hosted scene ids", () => {
  it("are <game>.<name>, each an engine id", () => {
    expect(parseSceneId("platformer.level-1")).toEqual({ game: "platformer", name: "level-1" });
    expect(parseSceneId("engine.yard")).toEqual({ game: "engine", name: "yard" });
    for (const bad of [
      "level-1",
      "Platformer.level",
      "a.b.c",
      ".x",
      "x.",
      "a.-b",
      `a.${"x".repeat(49)}`,
      7,
    ]) {
      expect(isSceneId(bad)).toBe(false);
    }
    expect(ID_PATTERN.test(`${"x".repeat(48)}`)).toBe(true);
    expect(isSceneId(`${"g".repeat(48)}.${"n".repeat(48)}`)).toBe(true);
  });

  it("make a document name the service parses", () => {
    expect(parseDocumentName(`scene:${"g".repeat(48)}.${"n".repeat(48)}`)).toEqual({
      kind: "scene",
      id: `${"g".repeat(48)}.${"n".repeat(48)}`,
    });
  });

  it("name no game for the engine's primitives", () => {
    expect(sceneGame(parseSceneId("engine.yard")!)).toBeUndefined();
    expect(sceneGame(parseSceneId("platformer.yard")!)).toBe("platformer");
  });
});
