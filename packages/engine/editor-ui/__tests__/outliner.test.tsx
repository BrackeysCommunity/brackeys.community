// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  DEFAULT_SNAP,
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
  const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });
  render(
    <KitProvider host={{ cue }}>
      <EditorOutliner session={session} onHover={onHover} notify={notify} />
    </KitProvider>,
  );
  return { session, dispatch, onHover, cue, notify };
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
let listPx = 2000;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const li = this.closest("li");
    const i = li ? [...(li.parentElement?.children ?? [])].indexOf(li) : -1;
    if (!li && this.classList.contains("je-outliner-list"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 200, height: listPx });
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

  it("shows one stack, each person once, on a closed row selected both itself and inside", () => {
    const { session } = setup(towerScene());
    fireEvent.click(outliner().getByRole("button", { name: "Collapse tower", expanded: true }));
    const bo = { id: "bo", name: "Bo", color: "#f00" };
    act(() =>
      session.store.setState((s) => ({
        ...s,
        peers: [
          {
            clientId: 7,
            user: bo,
            selection: [session.keyOf("tower")!, session.keyOf("barrel")!],
            mode: "edit",
          },
        ],
      })),
    );
    expect(within(row("tower")).getAllByRole("img")).toHaveLength(1);
    expect(
      within(row("tower")).getByRole("img", { name: "Selected here or inside by Bo" }),
    ).toBeTruthy();
    fireEvent.click(outliner().getByRole("button", { name: "Expand tower", expanded: false }));
    expect(within(row("tower")).getByRole("img", { name: "Selected by Bo" })).toBeTruthy();
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

  it("shows a drop that would make a loop as refused while held, reports why once let go, and dispatches nothing", async () => {
    const { session, dispatch, notify } = setup(towerScene());
    await drag(row("tower"), row("barrel"), "middle", () => {
      const li = row("barrel").closest("li")!;
      expect(li.hasAttribute("data-drop-refused")).toBe(true);
      expect(li.hasAttribute("data-drop-over")).toBe(false);
      const why = within(li).getByText(/would make a loop/);
      expect(why.getAttribute("role")).toBe("status");
      expect(why.getAttribute("data-tone")).toBe("danger");
      expect(why.hasAttribute("data-side")).toBe(false);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(entry(session, "tower").parent).toBeUndefined();
    expect(row("barrel").closest("li")!.hasAttribute("data-drop-refused")).toBe(false);
    expect(outliner().queryByText(/would make a loop/)).toBeNull();
    expect(notify.error).toHaveBeenCalledOnce();
    expect(notify.error).toHaveBeenCalledWith("Couldn't put tower under barrel", {
      description: expect.stringMatching(/would make a loop/),
    });
  });

  it("puts a held refusal above its row when one below would leave the list", async () => {
    setup(towerScene());
    listPx = 80;
    try {
      await drag(row("tower"), row("barrel"), "middle", () => {
        const why = within(row("barrel").closest("li")!).getByText(/would make a loop/);
        expect(why.getAttribute("data-side")).toBe("above");
      });
    } finally {
      listPx = 2000;
    }
  });

  it("draws drop marks over the row, where the aimed row's hover background can't cover them", () => {
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    /** The declarations of the first rule whose selector list has `selector`. */
    const rule = (selector: string) => {
      const at = [`${selector} {`, `${selector},`]
        .map((s) => css.indexOf(s))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      expect(at, selector).toBeDefined();
      return css.slice(css.indexOf("{", at), css.indexOf("}", at));
    };
    for (const mark of ["over", "before", "after", "refused"]) {
      expect(css).not.toContain(`.je-outliner-item[data-drop-${mark}] {`);
      expect(rule(`.je-outliner-item[data-drop-${mark}]::after`)).toMatch(/box-shadow:/);
    }
    const start = css.indexOf(".je-outliner-item:is(");
    const layer = css.slice(start, css.indexOf("}", start));
    expect(layer).toMatch(/\)::after \{/);
    expect(layer).toMatch(/z-index: [1-9]/);
    expect(layer).toContain("pointer-events: none");
    expect(rule(".je-outliner-row:hover:not(:disabled, [data-selected])")).not.toMatch(/z-index/);
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

  it("shows the root strip in the Tree view only while dragging, taking drops to the root", async () => {
    const { session } = setup(towerScene());
    const strip = () => outliner().getByText("Drop here to move to the root").parentElement!;
    expect(outliner().getByText("Drop here to move to the root").className).toBe(
      "je-outliner-none",
    );
    expect(strip().hasAttribute("data-idle")).toBe(true);
    expect(strip().getAttribute("aria-hidden")).toBe("true");
    await drag(row("barrel"), "strip", "middle", () => {
      expect(strip().hasAttribute("data-idle")).toBe(false);
      expect(strip().hasAttribute("aria-hidden")).toBe(false);
      expect(strip().hasAttribute("data-drop-over")).toBe(true);
    });
    expect(entry(session, "barrel").parent).toBeUndefined();
    expect(strip().hasAttribute("data-idle")).toBe(true);
    showView("Type");
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

  it("labels the view control and says in the Tree tab's hint that dragging reparents or reorders", async () => {
    setup(towerScene());
    expect(outliner().getByRole("group", { name: "Outline view" })).toBeTruthy();
    await act(async () => {
      fireEvent.focus(outliner().getByRole("button", { name: "Tree" }));
    });
    expect(
      await screen.findByText("Rows under their parents; drag to reparent or reorder"),
    ).toBeTruthy();
  });

  it("moves a focused row among its siblings with Alt+Up and Alt+Down, keeping it focused", () => {
    const { session, dispatch, cue, notify } = setup(towerScene());
    const lamp = row("lamp");
    expect(lamp.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Alt+ArrowDown");
    lamp.focus();
    fireEvent.keyDown(lamp, { key: "ArrowUp", altKey: true });
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Move lamp before crate",
      ops: [{ op: "reorder", refs: ["lamp"] }],
    });
    expect(cue).toHaveBeenCalledWith("drop");
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "barrel", "lamp", "crate"]);
    expect(document.activeElement).toBe(row("lamp"));

    fireEvent.keyDown(row("lamp"), { key: "ArrowUp", altKey: true });
    expect(levels().map(([n]) => n)).toEqual(["lamp", "tower", "base", "barrel", "crate"]);
    expect(document.activeElement).toBe(row("lamp"));

    dispatch.mockClear();
    fireEvent.keyDown(row("lamp"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(row("barrel"), { key: "ArrowDown", altKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(notify.warning.mock.calls.map((c) => c[0])).toEqual([
      "lamp is already first at the root.",
      "barrel is already last under base.",
    ]);

    const press = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => void row("lamp").dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);
    expect(levels().map(([n]) => n)).toEqual(["tower", "base", "barrel", "lamp", "crate"]);
    expect(
      session
        .getDoc()
        .entities!.filter((e) => !e.parent)
        .map((e) => e.id),
    ).toEqual(["tower", "lamp", "crate"]);
  });

  it("keeps a root row's twisty inside the list, with room for it before every tree row's label", () => {
    setup(towerScene());
    const twisty = outliner().getByRole("button", { name: "Collapse tower" });
    expect(parseFloat(twisty.style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(row("tower").style.paddingLeft)).toBeGreaterThanOrEqual(
      parseFloat(twisty.style.left) + 16,
    );
    expect(row("crate").style.paddingLeft).toBe(row("tower").style.paddingLeft);
    showView("Type");
    expect(row("crate").style.paddingLeft).toBe("20px");
  });

  it("groups and ungroups from its head, saying why it can't while it can't", async () => {
    const { session, dispatch } = setup(towerScene());
    const groupButton = () => outliner().getByRole("button", { name: "Group under a node" });
    const ungroupButton = () => outliner().getByRole("button", { name: "Ungroup" });
    expect(groupButton().getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.focus(groupButton());
    });
    expect(await screen.findByText("Select what to group.")).toBeTruthy();

    act(() => session.select(["crate", "lamp"]));
    expect(groupButton().getAttribute("aria-disabled")).not.toBe("true");
    expect(ungroupButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(groupButton());
    expect(dispatch.mock.calls[0]![0].label).toBe("Group 2 entities");
    expect(entry(session, "crate").parent).toBe("node-1");
    expect(session.store.state.selection).toEqual(["node-1"]);

    fireEvent.click(ungroupButton());
    expect(dispatch.mock.calls[1]![0].label).toBe("Ungroup node-1");
    expect(entry(session, "crate").parent).toBeUndefined();
    expect(session.getDoc().entities!.some((e) => e.id === "node-1")).toBe(false);
  });

  it("leaves arrows without Alt, and rows outside the Tree view, to the editor", () => {
    const { dispatch } = setup(towerScene());
    const plain = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    row("lamp").dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    showView("Type");
    const lamp = outliner().getByRole("button", { name: /^lamp/ });
    expect(lamp.hasAttribute("aria-keyshortcuts")).toBe(false);
    fireEvent.keyDown(lamp, { key: "ArrowUp", altKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dragging a selected row drags the selection's roots", async () => {
    const { session, dispatch } = setup(towerScene());
    act(() => session.select(["base", "barrel", "lamp", "~solid:0"]));
    await drag(row("lamp"), row("crate"));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Put 3 items under crate",
      ops: [
        { op: "promote", ref: "~solid:0", id: "solid-1" },
        { op: "reparent", refs: ["base", "lamp", "solid-1"], parent: "crate" },
      ],
    });
    expect(entry(session, "barrel").parent).toBe("base");
    expect(entry(session, "base").parent).toBe("crate");
    expect(entry(session, "solid-1").parent).toBe("crate");
    expect(session.store.state.selection).toEqual(["base", "barrel", "lamp", "solid-1"]);
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
    const router = createToolRouter();
    const host = createToolHost({
      session,
      router,
      toWorld: ({ x, y }) => [x / 100, y / 100],
      scale: () => 100,
      snap: { ...DEFAULT_SNAP, enabled: false },
    });
    render(
      <KitProvider host={{ cue: vi.fn() }}>
        <EditorOutliner session={session} />
        <EditorInspector session={session} />
      </KitProvider>,
    );
    const pointer = (type: "down" | "move" | "up", x: number, y: number) =>
      router.dispatch({
        kind: "pointer",
        type,
        screen: { x, y },
        button: 0,
        deltaY: 0,
        native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
      });
    const drawBox = ([x0, y0]: [number, number], [x1, y1]: [number, number]) =>
      act(() => {
        pointer("down", x0, y0);
        pointer("move", x1, y1);
        pointer("up", x1, y1);
      });
    // The base is a drawn solid, which has no id until it joins the tree. The barrel is a drawn
    // sensor, a collider of its own: the engine's draw tools place no marker to give one to.
    act(() => void host.setTool("box"));
    drawBox([560, 990], [640, 1010]);
    expect(session.getDoc().solid).toEqual([["box", 6, 10, 0.4, 0.1]]);
    act(() => void host.command("type:sensor"));
    drawBox([630, 955], [670, 975]);
    expect(session.getDoc().entities!.map((e) => [e.id, e.type])).toEqual([["sensor", "sensor"]]);

    act(() => void host.command("select-all"));
    await act(async () => {
      fireEvent.click(outliner().getByRole("button", { name: "Group under a node" }));
    });
    expect(levels()).toEqual([
      ["node-1", "1"],
      ["sensor", "2"],
      ["solid-1", "2"],
    ]);
    expect(session.getDoc().solid ?? []).toEqual([]);
    await drag(row("sensor"), row("solid-1"));
    expect(levels()).toEqual([
      ["node-1", "1"],
      ["solid-1", "2"],
      ["sensor", "3"],
    ]);
    const doc = session.getDoc();
    expect(doc.entities!.map((e) => [e.id, e.type, e.parent])).toEqual([
      ["node-1", "node", undefined],
      ["sensor", "sensor", "solid-1"],
      ["solid-1", "solid", "node-1"],
    ]);
    expect(session.store.state.issues).toEqual([]);

    const rapier = await import("@dimforge/rapier2d");
    const rt = createSceneRuntime({ rapier, view: null, registry, prefabs: prefabLibrary([]) });
    const report = rt.load(expandScene(doc, registry));
    expect(report.ok).toBe(true);
    const { tree } = rt.ctx;
    expect(tree.subtree("node-1")).toEqual(["node-1", "solid-1", "sensor"]);
    expect(rt.ctx.tags.handlesOf("sensor")).toHaveLength(1);
    const pose = (id: string): Pose => {
      const p = rt.ctx.poses.get(id)!;
      return { x: p.x, y: p.y, rot: p.rot };
    };
    const node = pose("node-1");
    const locals = ["solid-1", "sensor"].map((id) => relativePose(pose(id), node));
    rt.ctx.setPose("node-1", 8, 10, -Math.PI / 4);
    rt.step(rt.ctx.time.tickMs, []);
    for (const [i, id] of ["solid-1", "sensor"].entries()) {
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
