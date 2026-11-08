// @vitest-environment jsdom

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
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry, defineGame, type Registry } from "../../game/index";
import { prefabLibrary, SCENE_FORMAT_VERSION, type PrefabLibrary } from "../../scene/index";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { EditorOutliner } from "../panels/EditorOutliner";

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
  render(<EditorOutliner session={session} onHover={onHover} />);
  return { session, dispatch, onHover };
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
      "Decor",
      "Gameplay",
      "doors",
      "gatebox",
      "zonecircle",
      "pad1000.5, 1010",
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
    expect(rowNames().slice(2, 5)).toEqual(["Decor", "zonecircle", "pad1000.5, 1010"]);
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
      v: SCENE_FORMAT_VERSION,
      groups: { doors: { at: [0, 0] } },
      instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
    };
    const posts = prefabLibrary([
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "post",
        entities: [{ id: "top", type: "marker", at: [0, 0] }],
      },
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

describe("EditorOutliner attaching and nesting", () => {
  const ride = (id: string, x: number) => ({
    id,
    type: "follower",
    shape: ["box", x, 0, 10, 2] as const,
    path: {
      pts: [
        [0, 0],
        [50, 0],
      ] as [number, number][],
      mode: "loop" as const,
      speed: 10,
    },
  });
  const rides = (): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name: "rides",
    bounds: [0, 0, 1000, 1000],
    entities: [
      { id: "deck", type: "solid", shape: ["box", 100, 100, 20, 4] },
      { id: "trip", type: "sensor", shape: ["box", 200, 100, 8, 8], attach: "lift" },
      { ...ride("lift", 100), shape: ["box", 100, 0, 10, 2] },
    ],
    instances: [{ id: "gate-2", prefab: "gate", at: [500, 500] }],
  });
  const gates = prefabLibrary([
    {
      kind: "prefab",
      v: SCENE_FORMAT_VERSION,
      id: "gate",
      entities: [
        { ...ride("lift", 0), shape: ["box", 0, 0, 10, 2] },
        { id: "post", type: "marker", at: [0, 0] },
      ],
    },
  ]);

  it("attaches a row dropped on a follower's row, in one batch", async () => {
    const { session, dispatch } = setup(rides(), gates);
    await drag(
      outliner().getByRole("button", { name: /^deck/ }),
      outliner().getAllByRole("button", { name: /^lift/ })[0]!,
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toEqual({
      label: "Attach deck to lift",
      ops: [{ op: "update", ref: "deck", set: { attach: "lift" } }],
    });
    expect(session.getDoc().entities![0]).toMatchObject({ id: "deck", attach: "lift" });
    expect(session.store.state.history.at(-1)).toMatchObject({ label: "Attach deck to lift" });
  });

  it("attaches to an instance's child follower by its resolved ref", async () => {
    const { session } = setup(rides(), gates);
    const [, child] = outliner().getAllByRole("button", { name: /^lift/ });
    await drag(outliner().getByRole("button", { name: /^deck/ }), child!);
    expect(session.getDoc().entities![0]).toMatchObject({ id: "deck", attach: "gate-2/lift" });
  });

  it("detaches a row dropped on its type's row", async () => {
    const { session, dispatch } = setup(rides(), gates);
    await drag(
      outliner().getByRole("button", { name: /^trip/ }),
      outliner().getByRole("button", { name: /^sensor/ }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toEqual({
      label: "Detach trip",
      ops: [{ op: "update", ref: "trip", unset: ["attach"] }],
    });
    expect(session.getDoc().entities![1]!.attach).toBeUndefined();
    act(() => {
      session.undo();
    });
    expect(session.getDoc().entities![1]!.attach).toBe("lift");
  });

  it("changes nothing for a drop on a row that isn't a follower or the dragged row's type", async () => {
    const { dispatch } = setup(rides(), gates);
    await drag(
      outliner().getByRole("button", { name: /^deck/ }),
      outliner().getByRole("button", { name: /^trip/ }),
    );
    await drag(
      outliner().getByRole("button", { name: /^trip/ }),
      outliner().getByRole("button", { name: /^solid/ }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

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
      ["room-1", "2"],
      ["floor", "3"],
      ["door-1", "3"],
      ["Panel", "4"],
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
        groups: { hall: { at: [0, 0] } },
        instances: [
          { id: "room-1", prefab: "room", at: [50, 50], group: "hall" },
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
    expect(gameplay.slice(0, 11)).toEqual([
      ["Gameplay", "1"],
      ["hall", "2"],
      ["room-1", "3"],
      ["floor", "4"],
      ["door-1", "4"],
      ["Panel", "5"],
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
    expect(outliner().getByRole("button", { name: "Type" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
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
