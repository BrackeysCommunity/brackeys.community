// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      { id: "floor", type: "nav", shape: ["poly", 0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4] },
      {
        id: "room",
        type: "nav",
        shape: ["poly", 0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4],
        behaviors: { collider: { shape: ["poly", 0, 0, 2, 0, 1, 0.5, 2, 1, 0, 1] } },
      },
      {
        id: "rock",
        type: "prop",
        shape: ["poly", 0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4],
        density: 1,
        restitution: 0,
      },
      {
        id: "hinge",
        type: "marker",
        at: [1, 1],
        behaviors: { joint: { kind: "revolute", to: "rock" } },
      },
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
  const { rerender } = render(<EditorInspector session={session} />);
  return { session, dispatch, rerender };
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
    // The pieces are selected, so the inspector shows what the split made.
    expect(session.store.state.selection).toEqual(["ell-1", "ell-2"]);
    expect(screen.queryByRole("button", { name: SPLIT })).toBeNull();
    expect(session.undo()).toBe(true);
    expect(session.getDoc()).toEqual(before);
    session.destroy();
  });

  it("is not offered for a convex poly", () => {
    const { session } = setup("square");
    expect(screen.queryByRole("button", { name: SPLIT })).toBeNull();
    session.destroy();
  });

  it("is not offered for a nav area, whose polygon may be concave", () => {
    const { session } = setup("floor");
    expect(screen.queryByRole("button", { name: SPLIT })).toBeNull();
    session.destroy();
  });

  it("is offered once, for the concave collider it would split", () => {
    const { session } = setup("room");
    expect(screen.getAllByRole("button", { name: SPLIT })).toHaveLength(1);
    session.destroy();
  });

  it("shows a refusal inline and drops it when the selection changes", async () => {
    const { session } = setup("rock");
    fireEvent.click(screen.getByRole("button", { name: SPLIT }));
    await screen.findByText(/hinge names it/);
    act(() => session.select(["ell"]));
    await waitFor(() => expect(screen.queryByText(/hinge names it/)).toBeNull());
    expect(screen.getByRole("button", { name: SPLIT })).toBeTruthy();
    session.destroy();
  });

  it("drops a refusal once the scene changes, and the split then goes through", async () => {
    const { session } = setup("rock");
    fireEvent.click(screen.getByRole("button", { name: SPLIT }));
    await screen.findByText(/hinge names it/);
    act(() => void session.dispatch({ ops: [{ op: "remove", refs: ["hinge"] }] }));
    await waitFor(() => expect(screen.queryByText(/hinge names it/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: SPLIT }));
    await waitFor(() => expect(ids(session)).not.toContain("rock"));
    session.destroy();
  });

  it("names what it does in a short tooltip", async () => {
    const { session } = setup("ell");
    fireEvent.focus(screen.getByRole("button", { name: SPLIT }));
    expect(await screen.findByText("Replace with convex pieces (undo restores)")).toBeTruthy();
    session.destroy();
  });

  it("decomposes once per change of the entity, not on every render", async () => {
    const decompose = await import("../../scene/decompose");
    const original = decompose.splittableSite;
    // Validation calls it too; count only the inspector's own runs.
    let runs = 0;
    const spy = vi.spyOn(decompose, "splittableSite").mockImplementation((registry, e) => {
      if (new Error().stack?.includes("SplitConvexAction")) runs++;
      return original(registry, e);
    });
    const { session, rerender } = setup("ell");
    const settled = runs;
    expect(settled).toBeGreaterThan(0);
    rerender(<EditorInspector session={session} />);
    rerender(<EditorInspector session={session} />);
    expect(runs).toBe(settled);
    act(() => void session.dispatch({ ops: [{ op: "remove", refs: ["hinge"] }] }));
    await waitFor(() => expect(runs).toBeGreaterThan(settled));
    spy.mockRestore();
    session.destroy();
  });
});
