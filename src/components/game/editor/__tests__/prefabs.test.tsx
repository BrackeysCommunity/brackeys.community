// @vitest-environment jsdom
import { readLog, sceneToDoc, sequentialKeys, type SceneOrigin } from "@jams/engine/collab";
import { createEditorSession, type SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { prefabLibrary, type Prefab } from "@jams/engine/scene";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { EditorInspector } from "@/components/game/editor/EditorInspector";
import { EditorOutliner } from "@/components/game/editor/EditorOutliner";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const POST: Prefab = {
  kind: "prefab",
  v: 2,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
  bulk: { solid: [["box", 0, 0, 6, 40]] },
};

function scene(): SceneDefinition {
  return {
    v: 2,
    name: "posts",
    bounds: [0, 0, 2000, 1200],
    groups: { east: { at: [1000, 0] } },
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900], overrides: { "top.at": [0, -60] } },
      { id: "post-2", prefab: "post", at: [300, 900] },
      { id: "post-3", prefab: "post", at: [100, 900], group: "east" },
    ],
  };
}

function setup(selection: string[]) {
  const doc = sceneToDoc(scene(), {
    key: sequentialKeys("t"),
    prefabs: prefabLibrary([POST]),
  });
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "posts",
    registry,
    issuesDebounceMs: 0,
  });
  session.select(selection);
  return { session, doc };
}

const topOf = (session: ReturnType<typeof setup>["session"], instance: string) =>
  session.getResolved().entities!.find((e) => e.id === `${instance}/top`)!.at;

afterEach(cleanup);

describe("prefabs in the editor", () => {
  it("Apply to prefab updates every instance in one transaction, after a Confirm that counts them", () => {
    const { session, doc } = setup(["post-1"]);
    render(<EditorInspector session={session} />);
    expect(screen.getByText("top.at")).toBeTruthy();
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);

    fireEvent.click(screen.getByRole("button", { name: "Apply to prefab" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/all 3 of its instances change/)).toBeTruthy();
    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    });

    expect(transactions).toBe(1);
    expect(session.getPrefabs().get("post")!.entities[0]!.at).toEqual([0, -60]);
    expect(topOf(session, "post-1")).toEqual([100, 840]);
    expect(topOf(session, "post-2")).toEqual([300, 840]);
    expect(topOf(session, "post-3")).toEqual([1100, 840]);
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();
    expect(readLog(doc).at(-1)!.label).toBe("Apply post-1 to post");
    expect(session.undo()).toBe(true);
    expect(topOf(session, "post-2")).toEqual([300, 860]);
  });

  it("edits an instance child through the resolved view as an override, bold with a Revert", () => {
    const { session } = setup(["post-2/top"]);
    render(<EditorInspector session={session} />);
    const x = screen.getByLabelText("at.x") as HTMLInputElement;
    expect(x.value).toBe("300");
    fireEvent.change(x, { target: { value: "320" } });
    fireEvent.keyDown(x, { key: "Enter" });
    expect(session.getDoc().instances![1]!.overrides).toEqual({ "top.at": [20, -40] });
    expect(topOf(session, "post-2")).toEqual([320, 860]);
    const revert = screen.getByRole("button", { name: "Revert" });
    fireEvent.click(revert);
    expect(session.getDoc().instances![1]!.overrides).toBeUndefined();
  });

  it("unpacks an instance into plain entries where they stood", () => {
    const { session } = setup(["post-3"]);
    render(<EditorInspector session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpack" }));
    const def = session.getDoc();
    expect(def.instances!.map((i) => i.id)).toEqual(["post-1", "post-2"]);
    expect(def.entities).toEqual([{ id: "top", type: "marker", group: "east", at: [100, 860] }]);
    expect(def.solid).toEqual([["box", 1100, 900, 6, 40]]);
  });

  it("creates a prefab from a selection of entities", () => {
    const { session } = setup([]);
    session.dispatch({
      ops: [{ op: "add", entity: { id: "lamp", type: "marker", at: [500, 500] } }],
    });
    session.select(["lamp"]);
    render(<EditorInspector session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Create prefab" }));
    expect(session.getPrefabs().get("lamp")!.entities).toEqual([
      { id: "lamp", type: "marker", at: [0, 0] },
    ]);
    expect(session.getDoc().instances!.at(-1)).toEqual({
      id: "lamp-1",
      prefab: "lamp",
      at: [500, 500],
    });
  });

  it("lists instances with a prefab badge and their children in the outliner", () => {
    const { session } = setup([]);
    render(<EditorOutliner session={session} />);
    expect(screen.getAllByText("prefab").length).toBe(3);
    expect(screen.getAllByText("top").length).toBeGreaterThanOrEqual(3);
  });
});
