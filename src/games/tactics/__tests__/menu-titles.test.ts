import type { GameFlow, GameInstance } from "@jams/engine";
import type { SceneListEntry } from "@jams/engine/game";
import { sceneListFlow } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import sceneList from "../scene-list.json";
import { sceneTitle } from "../ui/menu";
import { tacticsProjectView } from "./pins";

type Titled = Pick<GameInstance, "flow" | "project">;

const flowOf = (scenes: readonly SceneListEntry[]): GameFlow =>
  ({ start: scenes[0]?.scene ?? null, scenes }) as unknown as GameFlow;

/** A game with no flow source, as the editor's Play makes, over the project's scene list. */
const editorGame = (): Titled => {
  const project = { ...tacticsProjectView(), flow: sceneListFlow(sceneList) };
  return { flow: flowOf([]), project: () => project };
};

describe("sceneTitle", () => {
  it("names a level by the project's scene list when the game has no flow source", () => {
    expect(sceneTitle(editorGame(), "level-1")).toBe("Ford");
    expect(sceneTitle(editorGame(), "level-2")).toBe("Bridge");
  });

  it("prefers the flow source's list, as the site's game has one", () => {
    const game: Titled = {
      flow: flowOf([{ scene: "level-1", title: "Shallows" }]),
      project: editorGame().project,
    };
    expect(sceneTitle(game, "level-1")).toBe("Shallows");
  });

  it("falls back to the id for an untitled or unlisted scene, or with no project", () => {
    expect(sceneTitle(editorGame(), "result")).toBe("result");
    expect(sceneTitle(editorGame(), "attic")).toBe("attic");
    expect(sceneTitle({ flow: flowOf([]), project: () => null }, "level-1")).toBe("level-1");
  });
});
