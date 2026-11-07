// @vitest-environment jsdom
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "@jams/engine/collab";
import { createEditorSession, type SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { prefabLibrary, type PrefabLibrary } from "@jams/engine/scene";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { EditorOutliner } from "@/components/game/editor/EditorOutliner";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "outline-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 500, 1040, 500, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "gate", type: "sensor", shape: ["box", 300, 600, 20, 40], group: "doors" },
      { id: "pad", type: "marker", at: [1000.5, 1010] },
    ],
  };
}

function setup(def: SceneDefinition = scene(), prefabs?: PrefabLibrary) {
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t"), ...(prefabs ? { prefabs } : {}) }),
    origin: ada,
    name: "outline-yard",
    registry,
    issuesDebounceMs: 0,
  });
  const dispatch = vi.spyOn(session, "dispatch");
  const onHover = vi.fn();
  render(<EditorOutliner session={session} onHover={onHover} />);
  return { session, dispatch, onHover };
}

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
/** Each row's text, without a container row's count. */
const rowNames = () =>
  outliner()
    .getAllByRole("listitem")
    .map((li) => {
      const text = li.textContent ?? "";
      return li.querySelector("[aria-expanded]") ? text.replace(/\d+$/, "") : text;
    });
const filter = (query: string) =>
  fireEvent.change(outliner().getByLabelText("Filter rows"), { target: { value: query } });

/**
 * jsdom lays nothing out, so each outliner row gets a 20px band by its place
 * in the list: enough for dnd-kit to find the row under the pointer.
 */
const ROW_PX = 20;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const li = this.closest("li");
    const i = li ? [...(li.parentElement?.children ?? [])].indexOf(li) : -1;
    return DOMRect.fromRect(i < 0 ? {} : { x: 0, y: i * ROW_PX, width: 200, height: ROW_PX });
  });
});
afterAll(() => vi.restoreAllMocks());

/** Drags `from` (a row button) onto the row named `to`, pointer-first as a mouse does it. */
async function drag(from: HTMLElement, to: HTMLElement) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const at = (r: DOMRect) => ({ clientX: r.x + 50, clientY: r.y + r.height / 2 });
  await act(async () => {
    fireEvent.pointerDown(from, { ...at(a), button: 0, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: a.x + 50, clientY: a.y + 30, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { ...at(b), pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerUp(document, { ...at(b), pointerId: 1 });
  });
  // dnd-kit swallows clicks on the document for 50ms after a drop.
  await act(() => new Promise((done) => setTimeout(done, 60)));
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; the guard matches the component's.
  }
});
afterEach(cleanup);

describe("EditorOutliner", () => {
  it("filters by type:, shape:, has:problems and free text, with removable chips", () => {
    setup();
    filter("type:sensor");
    expect(rowNames()).toEqual(["sensor", "zonecircle", "gatebox"]);
    expect(outliner().getByRole("button", { name: "Remove filter type:sensor" })).toBeTruthy();

    filter("type:sensor shape:box");
    expect(rowNames()).toEqual(["sensor", "gatebox"]);

    filter("has:problems");
    expect(outliner().getByRole("button", { name: /^pad/ })).toBeTruthy();
    expect(outliner().queryByRole("button", { name: /^zone/ })).toBeNull();

    filter("zo");
    expect(rowNames()).toEqual(["sensor", "zonecircle"]);

    filter("shape:circle zo");
    fireEvent.click(outliner().getByRole("button", { name: "Remove filter shape:circle" }));
    expect((outliner().getByLabelText("Filter rows") as HTMLInputElement).value).toBe("zo");

    filter("nothing-here");
    expect(outliner().getByText("Nothing matches.")).toBeTruthy();
  });

  it("keeps click, Shift range and Mod toggle selection, and reports hover", () => {
    const { session, onHover } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /^zone/ }));
    fireEvent.click(outliner().getByRole("button", { name: /^gate/ }), { shiftKey: true });
    expect([...session.store.state.selection].sort()).toEqual(["gate", "zone"]);
    fireEvent.click(outliner().getByRole("button", { name: /^zone/ }), { metaKey: true });
    expect(session.store.state.selection).toEqual(["gate"]);
    fireEvent.pointerEnter(outliner().getByRole("button", { name: /^pad/ }));
    expect(onHover).toHaveBeenLastCalledWith("pad");
  });

  it("lists rows by layer and group, and a drop onto a layer row moves the dragged rows in one batch", async () => {
    const { session, dispatch } = setup();
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    expect(rowNames()).toEqual([
      "Terrain",
      "solid",
      "Gameplay",
      "doors",
      "gatebox",
      "zonecircle",
      "pad1000.5, 1010",
      "Decor",
      "Editor",
    ]);

    act(() => session.select(["zone", "pad"]));
    const decor = outliner().getByRole("button", { name: /^Decor/ });
    await drag(outliner().getByRole("button", { name: /^pad/ }), decor);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Move 2 entities to Decor",
      ops: [
        { op: "update", ref: "zone", set: { layer: "decor" } },
        { op: "update", ref: "pad", set: { layer: "decor" } },
      ],
    });
    expect(rowNames().slice(-4)).toEqual(["Decor", "zonecircle", "pad1000.5, 1010", "Editor"]);
  });

  it("a drop onto a group row puts the row in that group", async () => {
    const { session, dispatch } = setup();
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    await drag(
      outliner().getByRole("button", { name: /^zone/ }),
      outliner().getByRole("button", { name: /^doors/ }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(session.getDoc().entities![0]).toMatchObject({ id: "zone", group: "doors" });
    expect(session.store.state.selection).toEqual([]);
  });

  it("a drop moves a prefab instance into a group", async () => {
    const def: SceneDefinition = {
      ...scene(),
      v: 2,
      groups: { doors: { at: [0, 0] } },
      instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
    };
    const posts = prefabLibrary([
      { kind: "prefab", v: 2, id: "post", entities: [{ id: "top", type: "marker", at: [0, 0] }] },
    ]);
    const { session, dispatch } = setup(def, posts);
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    await drag(
      outliner().getByRole("button", { name: /^post-1/ }),
      outliner().getByRole("button", { name: /^doors/ }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ label: "Group post-1 into doors" });
    expect(session.getDoc().instances![0]).toMatchObject({ id: "post-1", group: "doors" });
  });
});
