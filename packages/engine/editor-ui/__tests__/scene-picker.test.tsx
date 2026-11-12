// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyProjectBatch,
  createProjectSession,
  docToScene,
  layoutFromDoc,
  layoutToDoc,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
} from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import {
  createKindRegistry,
  SCENE_LIST_KIND,
  sceneListKind,
  type AssetEntry,
  type DocLayout,
  type SceneListFile,
} from "../../project/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/index";
import type { EditorHost, ProjectConnection, ProjectConnectionState } from "../host";
import { newSceneBatch, sceneIdFor, scenePickerRows } from "../panels/ScenePicker";
import { SceneEditor } from "../SceneEditor";
import { useWarmDocs, WARM_DOC_MS } from "../session/use-project-session";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const TEMPLATE = { bounds: [0, 0, 8, 6] as [number, number, number, number] };

const pickerGame = defineGame({
  id: "picker",
  types: [],
  actions: [],
  template: TEMPLATE,
  createRuntime: () => ({ snapshot: () => null }),
});

const sceneDef = (name: string): SceneDefinition =>
  ({
    v: SCENE_FORMAT_VERSION,
    game: "picker",
    name,
    bounds: [0, 0, 20, 12],
    entities: [{ id: "pad", type: "marker", at: [10, 10] }],
  }) as SceneDefinition;

const sceneEntry = (id: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind: "scene",
  path,
  created: { at: 0, by: "seed" },
});

const SCENES = [
  sceneEntry("yard", "scenes/yard.json"),
  sceneEntry("cellar", "scenes/cellar.json"),
  sceneEntry("attic", "scenes/attic.json"),
  sceneEntry("zoo", "scenes/zoo.json"),
  sceneEntry("barn", "scenes/barn.json"),
];

const LIST: SceneListFile = {
  kind: SCENE_LIST_KIND,
  v: 1,
  start: "yard",
  scenes: [
    { scene: "yard", title: "The Yard" },
    { scene: "cellar", sublevel: true },
    { scene: "attic", title: "Attic" },
  ],
};

const listLayout = sceneListKind.layout as DocLayout;

/** A project with five scenes, three of them listed, and a host whose `connect` opens it. */
function fakeProject() {
  const server = memoryDocHost();
  const listEntry: AssetEntry = {
    key: "list",
    id: "scene-list",
    kind: SCENE_LIST_KIND,
    path: "scene-list.json",
    created: { at: 0, by: "seed" },
  };
  seedProjectDoc(
    server.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: Object.fromEntries([...SCENES, listEntry].map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of SCENES)
    sceneToDoc(sceneDef(e.id), { doc: server.doc(`scene:p.${e.key}`), key: sequentialKeys(e.id) });
  layoutToDoc(server.doc("asset:p.list"), listLayout, LIST);

  const sessions: ProjectSession[] = [];
  const connect: EditorHost["connect"] = ({ project, registry, origin }) => {
    let state: ProjectConnectionState = {
      status: "connecting",
      session: null,
      access: "write",
      stopped: {},
      error: null,
      unsynced: 0,
    };
    const listeners = new Set<() => void>();
    let session: ProjectSession | null = null;
    void createProjectSession({
      project,
      openDoc: server.client().openDoc,
      origin,
      registry,
      kinds: createKindRegistry(registry.game),
    }).then((s) => {
      session = s;
      sessions.push(s);
      state = { ...state, status: "live", session: s };
      for (const l of listeners) l();
    });
    const connection: ProjectConnection = {
      getState: () => state,
      subscribe(l) {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      onAssetChanged: () => () => {},
      destroy: () => session?.destroy(),
    };
    return connection;
  };
  const onSceneChange = vi.fn<(id: string) => void>();
  const host: EditorHost = {
    assetUrl: (project, entry) => `/blobs/${project}/${entry.sha256}`,
    storage: null,
    connect,
    onSceneChange,
  };
  return { host, sessions, onSceneChange };
}

const rapier = () => import("@dimforge/rapier2d");

const trigger = (label: string) =>
  waitFor(() => screen.getByRole("button", { name: `Scene: ${label}` }), { timeout: 10_000 });

async function openMenu(label: string) {
  const button = await trigger(label);
  await act(async () => {
    fireEvent.click(button);
  });
  return screen.findAllByRole("menuitemradio");
}

const historyButton = (name: "Undo" | "Redo") => () =>
  waitFor(() => {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
const undoButton = historyButton("Undo");
const redoButton = historyButton("Redo");

const listValue = (session: ProjectSession) =>
  layoutFromDoc(session.get("asset:p.list")!.doc, listLayout) as unknown as SceneListFile;

beforeEach(() => {
  // Wide enough that the toolbar holds the picker beside every tool.
  vi.stubGlobal("innerWidth", 1600);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scenePickerRows", () => {
  it("lists the scene list's entries in order with titles, then the rest by path", () => {
    const byId = new Map(SCENES.map((e) => [e.id, e]));
    const rows = scenePickerRows({ byId } as never, {
      ...LIST,
      scenes: [...LIST.scenes, { scene: "gone" }],
    });
    expect(rows.map((r) => [r.id, r.label, r.listed, r.sublevel, r.start])).toEqual([
      ["yard", "The Yard", true, false, true],
      ["cellar", "cellar", true, true, false],
      ["attic", "Attic", true, false, false],
      ["barn", "barn", false, false, false],
      ["zoo", "zoo", false, false, false],
    ]);
  });

  it("turns a typed name into an id", () => {
    expect(sceneIdFor("  Level Two! ")).toBe("level-two");
    expect(sceneIdFor("Café 3")).toBe("cafe-3");
    expect(sceneIdFor("!!")).toBe("");
  });
});

describe("ScenePicker", () => {
  it("lists listed scenes first in list order with titles, then the rest by path, sublevels tagged and the open one checked", async () => {
    const { host } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    const items = await openMenu("The Yard");
    const paths = items.map((i) => i.querySelector(".je-option-choice-description")?.textContent);
    expect(paths).toEqual([
      "scenes/yard.json",
      "scenes/cellar.json",
      "scenes/attic.json",
      "scenes/barn.json",
      "scenes/zoo.json",
    ]);
    expect(items[0]!.textContent).toContain("The Yard");
    expect(within(items[0]!).getByText("Start")).toBeTruthy();
    expect(within(items[1]!).getByText("Sublevel")).toBeTruthy();
    expect(within(items[2]!).queryByText("Sublevel")).toBeNull();
    expect(items[2]!.textContent).toContain("Attic");
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
    const menu = items[0]!.closest('[role="menu"]') as HTMLElement;
    expect(within(menu).getByText("Scene list")).toBeTruthy();
    expect(within(menu).getByText("Not listed")).toBeTruthy();
  }, 20_000);

  it("moves into More tools as a submenu when the toolbar is short of room", async () => {
    vi.stubGlobal("innerWidth", 760);
    const { host } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    const more = await waitFor(() => screen.getByRole("button", { name: "More tools" }), {
      timeout: 10_000,
    });
    expect(screen.queryByRole("button", { name: "Scene: The Yard" })).toBeNull();
    await act(async () => {
      fireEvent.click(more);
    });
    const sub = await screen.findByRole("menuitem", { name: "Scene: The Yard" });
    await act(async () => {
      fireEvent.click(sub);
    });
    const items = await screen.findAllByRole("menuitemradio", { name: /scenes\// });
    expect(items.map((i) => i.querySelector(".je-option-choice-description")?.textContent)).toEqual(
      [
        "scenes/yard.json",
        "scenes/cellar.json",
        "scenes/attic.json",
        "scenes/barn.json",
        "scenes/zoo.json",
      ],
    );
  }, 20_000);

  it("creates a new scene from the game's template and lists it, as one undo step", async () => {
    const { host, sessions, onSceneChange } = fakeProject();
    const notify = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
    render(
      <SceneEditor
        host={{ ...host, notify }}
        game={pickerGame}
        project="p"
        scene="yard"
        rapier={rapier}
      />,
    );
    await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "New scene…" }));
    });
    const dialog = await screen.findByRole("alertdialog");
    const create = within(dialog).getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Level Two" } });
    expect(within(dialog).getByText("Its id: level-two")).toBeTruthy();
    expect(within(dialog).getByRole("switch", { name: "Add to scene list" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(create);
    });

    const session = sessions[0]!;
    await waitFor(() => expect(session.view().byId.get("level-two")).toBeTruthy());
    expect(session.view().byId.get("level-two")!.path).toBe("scenes/level-two.json");
    expect(listValue(session).scenes.at(-1)).toEqual({ scene: "level-two", title: "Level Two" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(notify.success).toHaveBeenCalledWith("Created Level Two");
    await trigger("Level Two");
    expect(onSceneChange).toHaveBeenLastCalledWith("level-two");
    const name = session.docNameFor(session.view().byId.get("level-two")!)!;
    expect(docToScene(session.get(name)!.doc).bounds).toEqual(TEMPLATE.bounds);
    const items = await openMenu("Level Two");
    expect(items[3]!.textContent).toContain("Level Two");
    expect(items[3]!.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(items[3]!, { key: "Escape" });
    });

    // Undone in the scene it made, the editor goes back to the scene it was made from.
    await act(async () => {
      fireEvent.click(await undoButton());
    });
    expect(session.view().byId.has("level-two")).toBe(false);
    expect(listValue(session).scenes.map((e) => e.scene)).toEqual(["yard", "cellar", "attic"]);
    expect(session.canUndo()).toBe(false);
    await trigger("The Yard");
    expect(onSceneChange).toHaveBeenLastCalledWith("yard");
    expect(notify.error).not.toHaveBeenCalled();

    // Redone from there, the new scene is back and the editor opens it again.
    await act(async () => {
      fireEvent.click(await redoButton());
    });
    expect(session.view().byId.has("level-two")).toBe(true);
    await trigger("Level Two");
    expect(onSceneChange).toHaveBeenLastCalledWith("level-two");
  }, 20_000);

  it("on an undo of a New scene… made elsewhere, returns to the scene it was made from", async () => {
    const { host, sessions, onSceneChange } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    const items = await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(items[2]!);
    });
    await openMenu("Attic");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "New scene…" }));
    });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Den" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });
    await trigger("Den");
    const session = sessions[0]!;
    // By way of another scene, so the scene it was last opened from isn't the one it was made from.
    const rows = await openMenu("Den");
    await act(async () => {
      fireEvent.click(rows[1]!);
    });
    await trigger("cellar");
    const again = await openMenu("cellar");
    await act(async () => {
      fireEvent.click(again[3]!);
    });
    await trigger("Den");

    await act(async () => {
      fireEvent.click(await undoButton());
    });
    expect(session.view().byId.has("den")).toBe(false);
    await trigger("Attic");
    expect(onSceneChange).toHaveBeenLastCalledWith("attic");
  }, 20_000);

  it("on an undo of a New scene… from another scene, switches to the new scene first, then undoes it", async () => {
    const { host, sessions, onSceneChange } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "New scene…" }));
    });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Loft" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });
    await trigger("Loft");
    const session = sessions[0]!;
    const items = await openMenu("Loft");
    await act(async () => {
      fireEvent.click(items[0]!);
    });
    await trigger("The Yard");

    const existedAtSwitch: boolean[] = [];
    onSceneChange.mockImplementation((id) => {
      if (id === "loft") existedAtSwitch.push(session.view().byId.has("loft"));
    });
    await act(async () => {
      fireEvent.click(await undoButton());
    });
    expect(existedAtSwitch).toEqual([true]);
    await waitFor(() => expect(session.view().byId.has("loft")).toBe(false));
    await trigger("The Yard");
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").some((s) => s.textContent?.includes("Undid New scene Loft")),
      ).toBe(true),
    );
    expect(session.canUndo()).toBe(false);
  }, 20_000);

  it("opens the Project settings panel from the toolbar", async () => {
    const { host } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Project settings…" }));
    });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Project settings" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
  }, 20_000);

  it("refuses a name another asset holds, in the dialog", async () => {
    const { host } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "New scene…" }));
    });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Zoo" } });
    expect(within(dialog).getByText(/The id "zoo" is taken/)).toBeTruthy();
    const create = within(dialog).getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  }, 20_000);

  it("switches by closing the live session on the scene and keeps its doc connected", async () => {
    const { host, sessions, onSceneChange } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    const items = await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(items[2]!);
    });
    await trigger("Attic");
    expect(onSceneChange).toHaveBeenCalledWith("attic");
    const session = sessions[0]!;
    expect(session.openDocs()).toContain("scene:p.attic");
    // Nothing else holds the yard's doc now: only the warm hold keeps it.
    expect(session.pinned()).not.toContain("scene:p.yard");
    expect(session.openDocs()).toContain("scene:p.yard");
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((s) => s.textContent?.includes("attic"))).toBe(
        true,
      ),
    );
  }, 20_000);

  it("on an undo whose step is in a scene that isn't open, switches there and says so", async () => {
    const { host, sessions, onSceneChange } = fakeProject();
    render(<SceneEditor host={host} game={pickerGame} project="p" scene="yard" rapier={rapier} />);
    await trigger("The Yard");
    const session = sessions[0]!;
    const removed = await applyProjectBatch(
      session,
      {
        v: 1,
        label: "Remove pad",
        ops: [{ op: "editScene", id: "yard", ops: [{ op: "remove", refs: ["pad"] }] }],
      },
      session.origin,
    );
    expect(removed.ok).toBe(true);
    expect(session.canUndo()).toBe(true);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    const items = await openMenu("The Yard");
    await act(async () => {
      fireEvent.click(items[2]!);
    });
    await trigger("Attic");
    const padAtSwitch: string[][] = [];
    onSceneChange.mockImplementation((id) => {
      if (id === "yard")
        padAtSwitch.push(
          docToScene(session.get("scene:p.yard")!.doc).entities?.map((e) => e.id) ?? [],
        );
    });
    await act(async () => {
      fireEvent.click(await undoButton());
    });
    await trigger("The Yard");
    expect(padAtSwitch, "the editor switched before the undo").toEqual([[]]);
    expect(onSceneChange).toHaveBeenLastCalledWith("yard");
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes("Undid Remove pad in The Yard")),
      ).toBe(true),
    );
    const yard = docToScene(session.get("scene:p.yard")!.doc);
    expect(yard.entities?.map((e) => e.id)).toEqual(["pad"]);
  }, 20_000);
});

describe("newSceneBatch", () => {
  it("leaves the list out when asked to, and a title the id already says", () => {
    const view = {
      byId: new Map([
        ["scene-list", { id: "scene-list", kind: SCENE_LIST_KIND, path: "scene-list.json" }],
      ]),
    } as never;
    expect(newSceneBatch(view, { name: "loft", near: "scenes/yard.json", list: true })).toEqual({
      id: "loft",
      batch: {
        v: 1,
        label: "New scene loft",
        ops: [
          { op: "createAsset", kind: "scene", id: "loft", path: "scenes/" },
          {
            op: "editAsset",
            id: "scene-list",
            edits: [{ insert: "/scenes/-", value: { scene: "loft" } }],
          },
        ],
      },
    });
    expect(newSceneBatch(view, { name: "loft", list: false }).batch.ops).toEqual([
      { op: "createAsset", kind: "scene", id: "loft", path: "" },
    ]);
  });
});

describe("useWarmDocs", () => {
  it("keeps a doc connected for a minute after the editor lets go of it, and lets go on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = memoryDocHost();
    seedProjectDoc(
      server.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: { yard: SCENES[0]! },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(sceneDef("yard"), { doc: server.doc("scene:p.yard"), key: sequentialKeys("yard") });
    const session = await createProjectSession({
      project: "p",
      openDoc: server.client().openDoc,
      origin: { kind: "user", userId: "u", name: "U" },
      registry: createRegistry(pickerGame),
      kinds: createKindRegistry(pickerGame),
    });
    const hook = renderHook(() => useWarmDocs());
    await session.open("scene:p.yard");
    await act(async () => hook.result.current(session, "scene:p.yard"));
    session.release("scene:p.yard");
    expect(session.openDocs()).toContain("scene:p.yard");
    act(() => void vi.advanceTimersByTime(WARM_DOC_MS - 1));
    expect(session.openDocs()).toContain("scene:p.yard");
    act(() => void vi.advanceTimersByTime(1));
    expect(session.openDocs()).not.toContain("scene:p.yard");

    await session.open("scene:p.yard");
    await act(async () => hook.result.current(session, "scene:p.yard"));
    session.release("scene:p.yard");
    expect(session.openDocs()).toContain("scene:p.yard");
    hook.unmount();
    expect(session.openDocs()).not.toContain("scene:p.yard");
    session.destroy();
  });
});
