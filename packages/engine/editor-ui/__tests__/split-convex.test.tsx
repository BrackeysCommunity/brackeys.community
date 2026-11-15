// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import { EditorInspector } from "../panels/EditorInspector";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const SPLIT = "Split into convex pieces";

afterEach(cleanup);

function setup(selection: string) {
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "split-yard",
    bounds: [0, 0, 20, 10],
    entities: [
      { id: "ell", type: "solid", shape: ["poly", 0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4] },
      { id: "square", type: "solid", shape: ["poly", 0, 0, 2, 0, 2, 2, 0, 2] },
    ],
  } as SceneDefinition;
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("x") }),
    origin: ada,
    name: "split-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  session.select([selection]);
  const dispatch = vi.spyOn(session, "dispatch");
  render(<EditorInspector session={session} />);
  return { session, dispatch };
}

const ids = (session: ReturnType<typeof setup>["session"]) =>
  session.getDoc().entities!.map((e) => e.id);

describe("Split into convex pieces", () => {
  it("is offered for a concave poly, applies as one batch, and undo restores it", async () => {
    const { session, dispatch } = setup("ell");
    const before = session.getDoc();
    fireEvent.click(screen.getByRole("button", { name: SPLIT }));
    await waitFor(() => expect(ids(session)).not.toContain("ell"));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(ids(session).filter((id) => id?.startsWith("ell-")).length).toBeGreaterThan(1);
    expect(session.undo()).toBe(true);
    expect(session.getDoc()).toEqual(before);
    session.destroy();
  });

  it("is not offered for a convex poly", () => {
    const { session } = setup("square");
    expect(screen.queryByRole("button", { name: SPLIT })).toBeNull();
    session.destroy();
  });
});
