// @vitest-environment jsdom

import { Store } from "@tanstack/store";
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

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import {
  createEditorSession,
  createToolHost,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createRegistry, defineGame, type Registry } from "../../game/index";
import type { AssetKey } from "../../project/index";
import { composePose, relativePose, type Pose } from "../../runtime/poses";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import { prefabLibrary, SCENE_FORMAT_VERSION, type PrefabLibrary } from "../../scene/index";
import { createToolRouter } from "../../tool-router";
import { EditorFrame } from "../frame/EditorFrame";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { EditorInspector } from "../panels/EditorInspector";
import { EditorOutliner } from "../panels/EditorOutliner";
import type { LoadedRun } from "../session/loaded-run";

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
      { id: "gate", type: "sensor", shape: ["box", 300, 600, 20, 40] },
      { id: "pad", type: "marker", at: [1000.005, 1010] },
    ],
  };
}

function setup(def: SceneDefinition = scene(), prefabs?: PrefabLibrary, reg: Registry = registry) {
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "outline-yard",
    registry: reg,
    issuesDebounceMs: 0,
    ...(prefabs
      ? { prefabs: { library: () => prefabs, subscribe: () => () => {}, open: async () => null } }
      : {}),
  });
  const dispatch = vi.spyOn(session, "dispatch");
  const onHover = vi.fn();
  const cue = vi.fn();
  render(
    <KitProvider host={{ cue }}>
      <EditorOutliner session={session} onHover={onHover} />
    </KitProvider>,
  );
  return { session, dispatch, onHover, cue };
}

/** The outliner under a host whose storage is `storage`. */
function renderWithStorage(storage: EditorStorage | null) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "outline-yard",
    registry,
    issuesDebounceMs: 0,
  });
  return render(
    <KitProvider host={{ storage }}>
      <EditorOutliner session={session} />
    </KitProvider>,
  );
}

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
/** Each row's text, without a container row's count. */
const rowNames = () =>
  outliner()
    .getAllByRole("listitem")
    .map((li) => {
      const text = li.textContent ?? "";
      return li.querySelector("[aria-expanded]") && !li.querySelector("[aria-pressed]")
        ? text.replace(/\d+$/, "")
        : text;
    });
const showView = (name: "Tree" | "Type" | "Layer") =>
  fireEvent.click(outliner().getByRole("button", { name }));
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
    if (!li && this.classList.contains("je-outliner-list"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 2000 });
    if (this.classList.contains("je-outliner-root"))
      return DOMRect.fromRect({ x: 0, y: 2000, width: 200, height: ROW_PX });
    return DOMRect.fromRect(i < 0 ? {} : { x: 0, y: i * ROW_PX, width: 200, height: ROW_PX });
  });
});
afterAll(() => vi.restoreAllMocks());

/**
 * Drags `from` (a row button) onto the row `to`, pointer-first as a mouse
 * does it: to its middle, its top or bottom edge, or (`to` null) the empty
 * space below every row, or the root strip shown while dragging.
 * `beforeRelease` sees the drag still held over its target.
 */
async function drag(
  from: HTMLElement,
  to: HTMLElement | null | "strip",
  where: "middle" | "top" | "bottom" = "middle",
  beforeRelease?: () => void,
) {
  const a = from.getBoundingClientRect();
  const rows = outliner().getAllByRole("listitem").length;
  const at = (r: DOMRect) => ({
    clientX: r.x + 50,
    clientY:
      r.y + (r === a || where === "middle" ? r.height / 2 : where === "top" ? 2 : r.height - 2),
  });
  await act(async () => {
    fireEvent.pointerDown(from, { ...at(a), button: 0, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: a.x + 50, clientY: a.y + 30, pointerId: 1 });
  });
  const b =
    to === "strip"
      ? outliner().getByText("Drop here to move to the root").parentElement!.getBoundingClientRect()
      : to
        ? to.getBoundingClientRect()
        : DOMRect.fromRect({ x: 0, y: rows * ROW_PX + 40, width: 200, height: ROW_PX });
  await act(async () => {
    fireEvent.pointerMove(document, { ...at(b), pointerId: 1 });
  });
  beforeRelease?.();
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
    showView("Type");
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

  it("asks the frame to bring each row it selects into the canvas's view, and nothing it deselects", () => {
    const session = createEditorSession({
      doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
      origin: ada,
      name: "outline-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const reveal = vi.fn(() => true);
    render(
      <EditorFrame
        host={{ storage: null }}
        panels={{
          context: {
            controls: {
              session,
              notify: Object.assign(vi.fn(), {
                error: vi.fn(),
                warning: vi.fn(),
                success: vi.fn(),
              }),
              runStore: new Store<LoadedRun | null>(null),
              playFrom: vi.fn(),
              onReplay: vi.fn(),
              frame: () => true,
            },
            physical: new Store<readonly SceneIssue[]>([]),
            pickedAsset: new Store<AssetKey | null>(null),
          },
          reveal,
        }}
      >
        <canvas />
      </EditorFrame>,
    );
    fireEvent.click(outliner().getByRole("button", { name: /^zone/ }));
    expect(reveal).toHaveBeenLastCalledWith(["zone"]);
    fireEvent.click(outliner().getByRole("button", { name: /^gate/ }), { shiftKey: true });
    expect(reveal).toHaveBeenLastCalledWith(["gate"]);
    fireEvent.click(outliner().getByRole("button", { name: /^pad/ }), { metaKey: true });
    expect(reveal).toHaveBeenLastCalledWith(["pad"]);
    expect(reveal).toHaveBeenCalledTimes(3);
    fireEvent.click(outliner().getByRole("button", { name: /^zone/ }), { metaKey: true });
    expect(session.store.state.selection).not.toContain("zone");
    expect(reveal).toHaveBeenCalledTimes(3);
    session.destroy();
  });

  it("lists rows by layer, and a drop onto a layer row moves the dragged rows in one batch", async () => {
    const { session, dispatch } = setup();
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    expect(rowNames()).toEqual([
      "Terrain",
      "solid",
      "Decor",
      "Gameplay",
      "zonecircle",
      "gatebox",
      "pad1000.005, 1010",
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
    expect(rowNames().slice(2, 5)).toEqual(["Decor", "zonecircle", "pad1000.005, 1010"]);
  });

  it("takes its layer rows from the registry, empty ones included, defaulting through them", async () => {
    const parallax = createRegistry(
      defineGame({
        id: "parallax",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        layers: [
          { name: "far-hills", description: "The distant backdrop.", draw: 0, scroll: [0.5, 1] },
          { name: "ground", description: "What things stand on.", draw: 5 },
          { name: "actors", description: "Things that move.", draw: 10, sort: "y" },
          { name: "notes", description: "Helpers.", draw: 60, editorOnly: true },
        ],
      }),
    );
    const def: SceneDefinition = {
      ...scene(),
      game: "parallax",
      entities: [
        { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], layer: "actors" },
        { id: "gate", type: "sensor", shape: ["box", 300, 600, 20, 40] },
        { id: "stray", type: "sensor", shape: ["box", 100, 600, 20, 40], layer: "terrain" },
        { id: "memo", type: "note", at: [10, 10], text: "Look here." },
      ],
    };
    const { session, dispatch } = setup(def, undefined, parallax);
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    const names = rowNames();
    expect(names.filter((n) => /^[A-Z]/.test(n))).toEqual([
      "Far Hills",
      "Ground",
      "Actors",
      "Notes",
    ]);
    const under = (title: string) => {
      const at = names.indexOf(title);
      const next = names.findIndex((n, i) => i > at && /^[A-Z]/.test(n));
      return names.slice(at + 1, next < 0 ? undefined : next);
    };
    expect(under("Far Hills")).toEqual(["solid", "gatebox", "straybox"]);
    expect(under("Ground")).toEqual([]);
    expect(under("Actors")).toEqual(["zonecircle"]);
    expect(under("Notes")).toHaveLength(1);
    expect(under("Notes")[0]).toMatch(/^memo/);

    await drag(
      outliner().getByRole("button", { name: /^stray/ }),
      outliner().getByRole("button", { name: /^Ground/ }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Move stray to Ground",
      ops: [{ op: "update", ref: "stray", set: { layer: "ground" } }],
    });
    expect(session.getDoc().entities!.find((e) => e.id === "stray")?.layer).toBe("ground");
  });
});

describe("EditorOutliner nesting", () => {
  it("shows nested instances' children as a tree that opens and closes", () => {
    const library = prefabLibrary([
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "door",
        entities: [{ id: "panel", type: "marker", at: [0, 0], name: "Panel" }],
      },
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "room",
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 40, 4] }],
        instances: [{ id: "door-1", prefab: "door", at: [10, 0] }],
      },
    ]);
    setup(
      {
        v: SCENE_FORMAT_VERSION,
        name: "rooms",
        bounds: [0, 0, 100, 100],
        instances: [{ id: "room-1", prefab: "room", at: [50, 50] }],
      },
      library,
    );
    const levels = () =>
      outliner()
        .getAllByRole("listitem")
        .map((li) => [li.querySelector("[aria-pressed] span")?.textContent, li.ariaLevel])
        .filter(([name]) => name);
    expect(levels()).toEqual([
      ["room-1", "1"],
      ["floor", "2"],
      ["door-1", "2"],
      ["Panel", "3"],
    ]);

    fireEvent.click(outliner().getByRole("button", { name: "Collapse door-1", expanded: true }));
    expect(levels().map(([n]) => n)).toEqual(["room-1", "floor", "door-1"]);
    fireEvent.click(outliner().getByRole("button", { name: "Collapse room-1", expanded: true }));
    expect(levels().map(([n]) => n)).toEqual(["room-1"]);
    fireEvent.click(outliner().getByRole("button", { name: "Expand room-1", expanded: false }));
    expect(levels().map(([n]) => n)).toEqual(["room-1", "floor", "door-1"]);
    expect(outliner().getByRole("button", { name: "Expand door-1", expanded: false })).toBeTruthy();
  });

  it("keeps an instance's child and nested rows under it in the layer view", () => {
    const library = prefabLibrary([
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "door",
        entities: [{ id: "panel", type: "marker", at: [0, 0], name: "Panel" }],
      },
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "room",
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 40, 4] }],
        instances: [{ id: "door-1", prefab: "door", at: [10, 0] }],
      },
    ]);
    const { session } = setup(
      {
        v: SCENE_FORMAT_VERSION,
        name: "rooms",
        bounds: [0, 0, 100, 100],
        instances: [
          { id: "room-1", prefab: "room", at: [50, 50] },
          { id: "room-2", prefab: "room", at: [20, 20] },
        ],
      },
      library,
    );
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    const levels = () =>
      outliner()
        .getAllByRole("listitem")
        .map((li) => [
          li.querySelector("[aria-pressed] span")?.textContent ??
            li.textContent?.replace(/\d+$/, ""),
          li.ariaLevel,
        ]);
    const gameplay = levels().slice(levels().findIndex(([n]) => n === "Gameplay"));
    expect(gameplay.slice(0, 10)).toEqual([
      ["Gameplay", "1"],
      ["room-1", "2"],
      ["floor", "3"],
      ["door-1", "3"],
      ["Panel", "4"],
      ["room-2", "2"],
      ["floor", "3"],
      ["door-1", "3"],
      ["Panel", "4"],
      ["Editor", "1"],
    ]);

    fireEvent.click(outliner().getAllByRole("button", { name: /^Panel/ })[1]!);
    expect(session.store.state.selection).toEqual(["room-2/door-1/panel"]);
    fireEvent.click(outliner().getByRole("button", { name: "Collapse room-1", expanded: true }));
    expect(levels().map(([n]) => n)).toContain("room-2");
    expect(levels().filter(([n]) => n === "floor")).toHaveLength(1);
  });
  it("keeps its view and collapsed rows in the host's storage, under jams-editor: keys only", () => {
    const stored = new Map<string, string>([
      ["game-editor:outline-view", JSON.stringify("layer")],
      ["game-editor:outline-collapsed", JSON.stringify({ "type:sensor": true })],
    ]);
    const storage: EditorStorage = {
      get: (key) => stored.get(key) ?? null,
      set: (key, value) => void stored.set(key, value),
    };
    const first = renderWithStorage(storage);
    expect(outliner().getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    showView("Type");
    expect(rowNames()).toContain("zonecircle");

    fireEvent.click(outliner().getByRole("button", { name: /^sensor/ }));
    fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
    expect(stored.get("jams-editor:outline-view")).toBe(JSON.stringify("layer"));
    expect(JSON.parse(stored.get("jams-editor:outline-collapsed") ?? "{}")).toEqual({
      "type:sensor": true,
    });
    expect([...stored.keys()].filter((k) => !k.startsWith("jams-editor:"))).toEqual([
      "game-editor:outline-view",
      "game-editor:outline-collapsed",
    ]);
    first.unmount();

    renderWithStorage(storage);
    expect(outliner().getByRole("button", { name: "Layer" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("renders, filters and switches views with a storage that throws, or none", () => {
    const throwing: EditorStorage = {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
    };
    for (const storage of [throwing, null]) {
      const view = renderWithStorage(storage);
      showView("Type");
      expect(rowNames()).toContain("zonecircle");
      filter("type:sensor");
      expect(rowNames()).toEqual(["sensor", "zonecircle", "gatebox"]);
      filter("");
      fireEvent.click(outliner().getByRole("button", { name: /^sensor/ }));
      expect(rowNames()).not.toContain("zonecircle");
      fireEvent.click(outliner().getByRole("button", { name: "Layer" }));
      expect(outliner().getByRole("button", { name: "Layer" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      view.unmount();
    }
  });
});

describe("EditorOutliner tree", () => {
  function towerScene(): SceneDefinition {
    return {
      v: SCENE_FORMAT_VERSION,
      name: "tree",
      bounds: [0, 0, 2000, 1200],
      solid: [["box", 500, 1040, 500, 20]],
      entities: [
        { id: "tower", type: "node", at: [100, 100], rot: 90 },
        { id: "base", type: "solid", parent: "tower", shape: ["box", 0, -10, 20, 10] },
        { id: "barrel", type: "marker", parent: "base", at: [10, -20] },
        { id: "crate", type: "solid", shape: ["box", 300, 300, 10, 10] },
        { id: "lamp", type: "marker", at: [50, 50] },
      ],
    };
  }
  const row = (name: string) => outliner().getByRole("button", { name: new RegExp(`^${name}`) });
  const levels = () =>
    outliner()
      .getAllByRole("listitem")
      .map((li) => [li.querySelector("[aria-pressed] span")?.textContent, li.ariaLevel])
      .filter(([name]) => name);
  const worldOf = (session: ReturnType<typeof setup>["session"], id: string) =>
    session.getResolved().entities!.find((e) => e.id === id)!;
  const entry = (session: ReturnType<typeof setup>["session"], id: string) =>
    session.getDoc().entities!.find((e) => e.id === id)!;

  it("is the default view, lists entities under their parents and bulk buckets last", () => {
    setup(towerScene());
    expect(outliner().getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(levels()).toEqual([
      ["tower", "1"],
      ["base", "2"],
      ["barrel", "3"],
      ["crate", "1"],
      ["lamp", "1"],
    ]);
    expect(rowNames().at(-1)).toBe("solid");
  });

  it("keeps another view a viewer chose, and comes back to the tree when asked", () => {
    const stored = new Map([["jams-editor:outline-view", JSON.stringify("type")]]);
    const storage: EditorStorage = {
      get: (key) => stored.get(key) ?? null,
      set: (key, value) => void stored.set(key, value),
    };
    const first = renderWithStorage(storage);
    expect(outliner().getByRole("button", { name: "Type" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    showView("Tree");
    expect(stored.get("jams-editor:outline-view")).toBe(JSON.stringify("tree"));
    first.unmount();
    renderWithStorage(storage);
    expect(outliner().getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("opens and closes a parent's rows, and a filter keeps the parents above a match", () => {
    setup(towerScene());
    fireEvent.click(outliner().getByRole("button", { name: "Collapse tower", expanded: true }));
    expect(levels().map(([n]) => n)).toEqual(["tower", "crate", "lamp"]);
    fireEvent.click(outliner().getByRole("button", { name: "Expand tower", expanded: false }));
    filter("barrel");
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "barrel"]);
  });

  it("shows who has something selected inside a closed parent", () => {
    const { session } = setup(towerScene());
    fireEvent.click(outliner().getByRole("button", { name: "Collapse tower", expanded: true }));
    act(() =>
      session.store.setState((s) => ({
        ...s,
        peers: [
          {
            clientId: 7,
            user: { id: "bo", name: "Bo", color: "#f00" },
            selection: [session.keyOf("barrel")!],
            mode: "edit",
          },
        ],
      })),
    );
    expect(within(row("tower")).getByLabelText(/Selected inside by/)).toBeTruthy();
  });

  it("a drop on a row reparents onto it, keeps the world pose, and undoes in one step", async () => {
    const { session, dispatch, cue } = setup(towerScene());
    const before = worldOf(session, "lamp").at;
    await drag(row("lamp"), row("crate"));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Put lamp under crate",
      ops: [{ op: "reparent", refs: ["lamp"], parent: "crate" }],
    });
    expect(cue).toHaveBeenCalledWith("drop");
    expect(entry(session, "lamp").parent).toBe("crate");
    expect(worldOf(session, "lamp").at).toEqual(before);
    expect(levels().slice(3)).toEqual([
      ["crate", "1"],
      ["lamp", "2"],
    ]);
    act(() => void session.undo());
    expect(entry(session, "lamp").parent).toBeUndefined();
    expect(entry(session, "lamp").at).toEqual([50, 50]);
  });

  it("a drop on a row's top edge reorders before it, reparenting first when the parent differs", async () => {
    const { session, dispatch } = setup(towerScene());
    await drag(row("lamp"), row("barrel"), "top");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Move lamp before barrel",
      ops: [
        { op: "reparent", refs: ["lamp"], parent: "base" },
        { op: "reorder", refs: ["lamp"], index: 2 },
      ],
    });
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "lamp", "barrel", "crate"]);
    act(() => void session.undo());
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual([
      "tower",
      "base",
      "barrel",
      "crate",
      "lamp",
    ]);
    expect(entry(session, "lamp").parent).toBeUndefined();

    dispatch.mockClear();
    await drag(row("lamp"), row("crate"), "top");
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      ops: [{ op: "reorder", refs: ["lamp"], index: 3 }],
    });
  });

  it("a drop on the empty space below the rows puts a row at the root", async () => {
    const { session, dispatch } = setup(towerScene());
    await drag(row("barrel"), null);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Move barrel to the root",
      ops: [{ op: "reparent", refs: ["barrel"], parent: null }],
    });
    expect(entry(session, "barrel").parent).toBeUndefined();
  });

  it("shows a drop that would make a loop as refused before release, says why by the row, and dispatches nothing", async () => {
    const { session, dispatch, cue } = setup(towerScene());
    await drag(row("tower"), row("barrel"), "middle", () => {
      const li = row("barrel").closest("li")!;
      expect(li.hasAttribute("data-drop-refused")).toBe(true);
      expect(li.hasAttribute("data-drop-over")).toBe(false);
      const why = within(li).getByText(/would make a loop/);
      expect(why.getAttribute("role")).toBe("status");
      expect(why.getAttribute("data-tone")).toBe("danger");
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(cue).toHaveBeenCalledWith("error");
    expect(entry(session, "tower").parent).toBeUndefined();
    expect(row("barrel").closest("li")!.hasAttribute("data-drop-refused")).toBe(false);
    // The reason stays by the row once it's let go, until the next press.
    expect(within(row("barrel").closest("li")!).getByText(/would make a loop/)).toBeTruthy();
    fireEvent.pointerDown(row("crate"));
    expect(outliner().queryByText(/would make a loop/)).toBeNull();
  });

  it("marks an accepted drop on the row it would land on", async () => {
    setup(towerScene());
    await drag(row("lamp"), row("crate"), "middle", () => {
      expect(row("crate").closest("li")!.hasAttribute("data-drop-over")).toBe(true);
    });
    await drag(row("lamp"), row("crate"), "top", () => {
      expect(row("crate").closest("li")!.hasAttribute("data-drop-before")).toBe(true);
    });
    await drag(row("crate"), row("barrel"), "bottom", () => {
      expect(row("barrel").closest("li")!.hasAttribute("data-drop-after")).toBe(true);
    });
  });

  it("a drop on a row's bottom edge puts it after that row, the last place among its siblings", async () => {
    const { session, dispatch } = setup(towerScene());
    await drag(row("lamp"), row("barrel"), "bottom");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0].ops[0]).toEqual({
      op: "reparent",
      refs: ["lamp"],
      parent: "base",
    });
    expect(levels()).toEqual([
      ["tower", "1"],
      ["base", "2"],
      ["barrel", "3"],
      ["lamp", "3"],
      ["crate", "1"],
    ]);
    expect(entry(session, "lamp").parent).toBe("base");

    dispatch.mockClear();
    await drag(row("tower"), row("crate"), "bottom");
    expect(levels().map(([n]) => n)).toEqual(["crate", "tower", "base", "barrel", "lamp"]);
  });

  it("takes a row's bottom edge as onto it where its open children follow it", async () => {
    const { dispatch } = setup(towerScene());
    await drag(row("lamp"), row("base"), "bottom");
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Put lamp under base",
      ops: [{ op: "reparent", refs: ["lamp"], parent: "base" }],
    });
  });

  it("splits a row that can't take children into before and after halves", async () => {
    const def = towerScene();
    def.entities!.push({ id: "memo", type: "note", at: [10, 10], text: "Look here." });
    const { dispatch } = setup(def);
    await drag(row("crate"), row("memo"), "bottom", () => {
      expect(row("memo").closest("li")!.hasAttribute("data-drop-after")).toBe(true);
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(
      levels()
        .map(([n]) => n)
        .slice(-2),
    ).toEqual(["memo", "crate"]);
  });

  it("shows a root strip only while dragging, which moves a row to the root however full the list", async () => {
    const { session } = setup(towerScene());
    expect(outliner().queryByText("Drop here to move to the root")).toBeNull();
    await drag(row("barrel"), "strip", "middle", () => {
      expect(outliner().getByText("Drop here to move to the root")).toBeTruthy();
      expect(
        outliner()
          .getByText("Drop here to move to the root")
          .parentElement!.hasAttribute("data-drop-over"),
      ).toBe(true);
    });
    expect(entry(session, "barrel").parent).toBeUndefined();
    expect(outliner().queryByText("Drop here to move to the root")).toBeNull();
  });

  it("moves a root row to the end of the root on a drop on the root", async () => {
    setup(towerScene());
    await drag(row("crate"), "strip");
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "barrel", "lamp", "crate"]);
  });

  it("opens a closed row a drop puts rows under, so they stay in sight", async () => {
    const { session } = setup(towerScene());
    fireEvent.click(outliner().getByRole("button", { name: "Collapse base", expanded: true }));
    fireEvent.click(outliner().getByRole("button", { name: "Collapse tower", expanded: true }));
    expect(levels().map(([n]) => n)).toEqual(["tower", "crate", "lamp"]);
    await drag(row("lamp"), row("tower"));
    expect(entry(session, "lamp").parent).toBe("tower");
    expect(outliner().getByRole("button", { name: "Collapse tower", expanded: true })).toBeTruthy();
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "lamp", "crate"]);
  });

  it("says in the Tree tab's hint that edges reorder", async () => {
    setup(towerScene());
    await act(async () => {
      fireEvent.focus(outliner().getByRole("button", { name: "Tree" }));
    });
    expect(
      await screen.findByText(
        "Rows under their parents; drag a row onto another to put it under it, or onto its top or bottom edge to put it before or after it",
      ),
    ).toBeTruthy();
  });

  it("dragging a selected row drags the selection's roots", async () => {
    const { session, dispatch } = setup(towerScene());
    act(() => session.select(["base", "barrel", "lamp", "~solid:0"]));
    await drag(row("lamp"), row("crate"));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Put 2 items under crate",
      ops: [{ op: "reparent", refs: ["base", "lamp"], parent: "crate" }],
    });
    expect(entry(session, "barrel").parent).toBe("base");
    expect(entry(session, "base").parent).toBe("crate");
  });

  it("keeps an instance's children as rows that take drops but can't be dragged out", async () => {
    const library = prefabLibrary([
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "turret",
        entities: [{ id: "barrel", type: "solid", shape: ["box", 0, 0, 4, 1] }],
      },
    ]);
    const { session, dispatch } = setup(
      {
        v: SCENE_FORMAT_VERSION,
        name: "turrets",
        bounds: [0, 0, 100, 100],
        instances: [{ id: "t-1", prefab: "turret", at: [50, 50] }],
        entities: [{ id: "sight", type: "sensor", shape: ["box", 10, 10, 2, 2] }],
      },
      library,
    );
    expect(levels()).toEqual([
      ["sight", "1"],
      ["t-1", "1"],
      ["barrel", "2"],
    ]);
    await drag(row("barrel"), row("sight"));
    expect(dispatch).not.toHaveBeenCalled();

    await drag(row("sight"), row("barrel"));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      ops: [{ op: "reparent", refs: ["sight"], parent: "t-1/barrel" }],
    });
    expect(levels()).toEqual([
      ["t-1", "1"],
      ["barrel", "2"],
      ["sight", "3"],
    ]);
    expect(session.getDoc().entities![0]!.parent).toBe("t-1/barrel");
  });
  it("builds a turret by hand (a node, a base under it, a barrel with a collider under the base) that plays as one", async () => {
    const session = createEditorSession({
      doc: sceneToDoc(
        { v: SCENE_FORMAT_VERSION, name: "turret", bounds: [0, 0, 20, 20] },
        { key: sequentialKeys("t") },
      ),
      origin: ada,
      name: "turret",
      registry,
      issuesDebounceMs: 0,
    });
    const host = createToolHost({
      session,
      router: createToolRouter(),
      toWorld: ({ x, y }) => [x / 100, y / 100],
      scale: () => 100,
    });
    render(
      <KitProvider host={{ cue: vi.fn() }}>
        <EditorOutliner session={session} />
        <EditorInspector session={session} />
      </KitProvider>,
    );
    // The batches the draw and place tools commit.
    act(() => {
      session.dispatch({
        label: "Add base",
        ops: [
          { op: "add", entity: { id: "base", type: "solid", shape: ["box", 6, 10, 0.4, 0.2] } },
        ],
      });
      session.dispatch({
        label: "Add barrel",
        ops: [{ op: "add", entity: { id: "barrel", type: "marker", at: [6.5, 9.65] } }],
      });
      session.select(["base", "barrel"]);
    });
    act(() => void host.command("group"));
    expect(levels()).toEqual([
      ["node-1", "1"],
      ["base", "2"],
      ["barrel", "2"],
    ]);
    await drag(row("barrel"), row("base"));
    expect(levels()).toEqual([
      ["node-1", "1"],
      ["base", "2"],
      ["barrel", "3"],
    ]);
    act(() => session.select(["barrel"]));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    });
    const collider = (await screen.findAllByRole("menuitem")).find((i) =>
      i.textContent?.startsWith("Collider"),
    )!;
    await act(async () => {
      fireEvent.click(collider);
    });
    const doc = session.getDoc();
    expect(doc.entities!.map((e) => [e.id, e.type, e.parent])).toEqual([
      ["node-1", "node", undefined],
      ["base", "solid", "node-1"],
      ["barrel", "marker", "base"],
    ]);
    expect(Object.keys(doc.entities![2]!.behaviors ?? {})).toEqual(["collider"]);
    expect(session.store.state.issues).toEqual([]);

    const rapier = await import("@dimforge/rapier2d");
    const rt = createSceneRuntime({ rapier, view: null, registry, prefabs: prefabLibrary([]) });
    const report = rt.load(expandScene(doc, registry));
    expect(report.ok).toBe(true);
    const { tree } = rt.ctx;
    expect(tree.subtree("node-1")).toEqual(["node-1", "base", "barrel"]);
    expect(rt.ctx.tags.handlesOf("barrel")).toHaveLength(1);
    const pose = (id: string): Pose => {
      const p = rt.ctx.poses.get(id)!;
      return { x: p.x, y: p.y, rot: p.rot };
    };
    const node = pose("node-1");
    const locals = ["base", "barrel"].map((id) => relativePose(pose(id), node));
    rt.ctx.setPose("node-1", 8, 10, -Math.PI / 4);
    rt.step(rt.ctx.time.tickMs, []);
    for (const [i, id] of ["base", "barrel"].entries()) {
      const want = composePose(8, 10, -Math.PI / 4, locals[i]!);
      const got = pose(id);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
      expect(got.rot).toBeCloseTo(want.rot, 6);
    }
    rt.destroy();
    host.destroy();
    session.destroy();
  });
});
