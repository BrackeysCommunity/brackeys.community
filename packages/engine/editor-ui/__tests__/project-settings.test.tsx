// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  createProjectSession,
  layoutFromDoc,
  layoutToDoc,
  memoryDocHost,
  projectPeers,
  readLog,
  readProjectLog,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  setProjectPresence,
  type MemoryDocHost,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createRegistry, defineEntityType, defineGame, shapeField } from "../../game/index";
import type { Binding } from "../../game/types";
import {
  createKindRegistry,
  GAME_SETTINGS_KIND,
  gameSettingsKind,
  INPUT_MAP_KIND,
  inputMapKind,
  SCENE_LIST_KIND,
  sceneListKind,
  type AssetEntry,
  type CodeModuleInfo,
  type DocLayout,
  type SceneListFile,
} from "../../project/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/index";
import type { EditorNotify } from "../host";
import { KitProvider } from "../kit/index";
import { PANELS } from "../panels/registry";
import type { CaptureBinding } from "../panels/settings/InputPanel";
import { ProjectSettings } from "../panels/settings/ProjectSettings";
import { collisionGroupRows, layerRows } from "../panels/settings/registered";
import type { EditorProjectLink } from "../session/use-scene-editor";

const game = defineGame({
  id: "yard",
  types: [
    defineEntityType({
      type: "crate",
      base: "solid",
      description: "A box.",
      fields: { shape: shapeField("Body.") },
    }),
  ],
  actions: [
    { action: "jump", description: "Jump.", bindings: [{ device: "key", code: "Space" }] },
    {
      action: "walk",
      kind: "axis",
      description: "Walk.",
      bindings: [{ device: "key", code: "KeyA", value: -1 }],
    },
    {
      action: "menu",
      ui: true,
      description: "Open the menu.",
      bindings: [{ device: "key", code: "Escape" }],
    },
  ],
  projectSettings: {
    lives: z.number().int().min(1).max(9).optional().describe("Lives per run."),
  },
  layers: [
    { name: "ground", description: "The floor.", draw: 0 },
    { name: "actors", description: "Things that move.", draw: 10 },
  ],
  collisionGroups: { player: { collidesWith: ["static"] } },
  world: { lengthUnit: 32 },
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);
const kinds = createKindRegistry(game);

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };
const PROJECT = "yard";

const entry = (key: string, id: string, kind: string, path: string): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

const SCENES = [
  entry("kyard", "yard", "scene", "scenes/yard.json"),
  entry("kcellar", "cellar", "scene", "scenes/cellar.json"),
  entry("kattic", "attic", "scene", "scenes/attic.json"),
];
const SETTINGS = entry("kset", "game-settings", GAME_SETTINGS_KIND, "game-settings.json");
const INPUT = entry("kin", "input-map", INPUT_MAP_KIND, "input-map.json");
const LIST = entry("klist", "scene-list", SCENE_LIST_KIND, "scene-list.json");

const doc = (key: string) => `asset:${PROJECT}.${key}`;
const layoutOf = (kind: { layout: unknown }) => kind.layout as DocLayout;

const sceneDef = (name: string): SceneDefinition =>
  ({
    v: SCENE_FORMAT_VERSION,
    game: "yard",
    name,
    bounds: [0, 0, 20, 12],
    entities: [],
  }) as SceneDefinition;

const CODE = {
  "src/yard.ts": { registers: { types: ["crate"] } },
  "src/helpers.ts": { registers: {} },
} satisfies Record<string, CodeModuleInfo>;

/** A project with its three settings docs, unless `without` names one, and two clients' factory. */
function project(without: string[] = []) {
  const host = memoryDocHost();
  const docs = [SETTINGS, INPUT, LIST].filter((e) => !without.includes(e.kind));
  seedProjectDoc(
    host.doc(`project:${PROJECT}`),
    {
      meta: { projectId: PROJECT, layout: 1, name: "Yard" },
      assets: Object.fromEntries([...SCENES, ...docs].map((e) => [e.key, e])),
      history: {},
      code: CODE,
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of SCENES)
    sceneToDoc(sceneDef(e.id), {
      doc: host.doc(`scene:${PROJECT}.${e.key}`),
      key: sequentialKeys(e.id),
    });
  layoutToDoc(host.doc(doc("kset")), layoutOf(gameSettingsKind), {
    kind: GAME_SETTINGS_KIND,
    v: 2,
    engine: {},
    game: { lives: 3 },
  });
  layoutToDoc(host.doc(doc("kin")), layoutOf(inputMapKind), { kind: INPUT_MAP_KIND, v: 1 });
  layoutToDoc(host.doc(doc("klist")), layoutOf(sceneListKind), {
    kind: SCENE_LIST_KIND,
    v: 1,
    start: "yard",
    scenes: [{ scene: "yard", title: "The Yard" }, { scene: "cellar" }],
  });
  return host;
}

const sessions: ProjectSession[] = [];

async function client(host: MemoryDocHost, origin: SceneOrigin) {
  const peer = host.client();
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: peer.openDoc,
    origin,
    registry,
    kinds,
  });
  sessions.push(session);
  return { session, peer };
}

const notify: EditorNotify = Object.assign(vi.fn(), {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
});

/** One editor's settings panel on `session`; `capture` stands for the running game's. */
function mount(session: ProjectSession, capture: CaptureBinding | null = null) {
  const link: EditorProjectLink = { session, doc: `scene:${PROJECT}.kyard`, scene: "yard" };
  const view = render(
    <KitProvider host={{ storage: null }}>
      <ProjectSettings project={link} notify={notify} capture={capture} />
    </KitProvider>,
  );
  return within(view.container);
}

type Panel = ReturnType<typeof mount>;

async function openTab(panel: Panel, name: string) {
  const tab = panel.getByRole("tab", { name });
  await act(async () => {
    fireEvent.click(tab);
  });
}

const valueOf = (session: ProjectSession, key: string, kind: { layout: unknown }) =>
  layoutFromDoc(session.get(doc(key))!.doc, layoutOf(kind));
const listOf = (session: ProjectSession) =>
  valueOf(session, "klist", sceneListKind) as unknown as SceneListFile;
const sceneOrder = (session: ProjectSession) => listOf(session).scenes.map((e) => e.scene);

const portal = () => within(document.body);

async function confirmDialog(text = "Remove") {
  const button = await waitFor(() => portal().getByRole("button", { name: text }));
  await act(async () => {
    fireEvent.click(button);
  });
}

async function commitText(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
  vi.clearAllMocks();
});

describe("the project settings panel", () => {
  it("is a panel of the editor's tab groups, with five sections", async () => {
    expect(PANELS.find((p) => p.id === "settings")?.title).toBe("Project settings");
    const { session } = await client(project(), ada);
    const panel = mount(session);
    expect(panel.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General",
      "Engine",
      "Input",
      "Scenes",
      "Layers",
    ]);
  });

  it("General edits the game-settings doc's game block, as one history entry by its actor", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    const lives = await panel.findByRole("textbox", { name: "game.lives" });
    await commitText(lives, "5");
    await waitFor(() =>
      expect(valueOf(session, "kset", gameSettingsKind).game).toEqual({ lives: 5 }),
    );
    const log = readLog(session.get(doc("kset"))!.doc);
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toEqual(ada);
    expect(session.canUndo()).toBe(true);
  });

  it("Engine edits physics and gravity in m/s², and shows the game's px per metre read-only", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Engine");
    const physics = await panel.findByRole("group", { name: "engine.physics" });
    await act(async () => {
      fireEvent.click(within(physics).getByRole("button", { name: "none" }));
    });
    await waitFor(() =>
      expect(valueOf(session, "kset", gameSettingsKind).engine).toEqual({ physics: "none" }),
    );
    expect(panel.getAllByText("m/s²").length).toBeGreaterThan(0);
    await commitText(panel.getByRole("textbox", { name: "engine.gravity.y" }), "20");
    await waitFor(() =>
      expect(valueOf(session, "kset", gameSettingsKind).engine).toEqual({
        physics: "none",
        gravity: [0, 20],
      }),
    );
    expect(panel.getByLabelText("px per metre").textContent).toBe("32 px/m");
  });

  it("Input lists the game's actions with their bindings, the UI-only one tagged", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Input");
    const menu = await panel.findByRole("group", { name: "menu" });
    expect(within(menu).getByText("UI")).toBeTruthy();
    expect(within(panel.getByRole("group", { name: "jump" })).queryByText("UI")).toBeNull();
    expect(within(panel.getByLabelText("jump bindings")).getByText("Space")).toBeTruthy();
  });

  it("capture adds a binding to the input map, over the game's", async () => {
    const { session } = await client(project(), ada);
    const capture = vi.fn<CaptureBinding>(async () => ({ device: "key", code: "KeyJ" }));
    const panel = mount(session, capture);
    await openTab(panel, "Input");
    const jump = await panel.findByRole("group", { name: "jump" });
    await act(async () => {
      fireEvent.click(within(jump).getByRole("button", { name: "Add binding" }));
    });
    expect(capture).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(valueOf(session, "kin", inputMapKind).actions).toEqual([
        {
          action: "jump",
          bindings: [
            { device: "key", code: "Space" },
            { device: "key", code: "KeyJ" },
          ],
        },
      ]),
    );
    expect(within(panel.getByLabelText("jump bindings")).getByText("J")).toBeTruthy();
  });

  it("capture on an axis action binds the chosen direction", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session, async () => ({ device: "key", code: "KeyD" }) as Binding);
    await openTab(panel, "Input");
    const walk = await panel.findByRole("group", { name: "walk" });
    await act(async () => {
      fireEvent.click(within(walk).getByRole("button", { name: "+" }));
    });
    await act(async () => {
      fireEvent.click(within(walk).getByRole("button", { name: "Add binding" }));
    });
    await waitFor(() =>
      expect(valueOf(session, "kin", inputMapKind).actions).toEqual([
        {
          action: "walk",
          bindings: [
            { device: "key", code: "KeyA", value: -1 },
            { device: "key", code: "KeyD", value: 1 },
          ],
        },
      ]),
    );
  });

  it("removing a binding asks through Confirm first", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Input");
    const remove = await panel.findByRole("button", { name: "Remove Space from jump" });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(await portal().findByText("Remove Space?")).toBeTruthy();
    expect(valueOf(session, "kin", inputMapKind).actions).toBeUndefined();
    await confirmDialog();
    await waitFor(() =>
      expect(valueOf(session, "kin", inputMapKind).actions).toEqual([
        { action: "jump", bindings: [] },
      ]),
    );
  });

  it("Input edits seats and deadzone", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Input");
    await commitText(await panel.findByRole("textbox", { name: "players.max" }), "2");
    await waitFor(() =>
      expect(valueOf(session, "kin", inputMapKind).players).toEqual({ max: 2, join: "auto" }),
    );
    await commitText(panel.getByRole("textbox", { name: "deadzone" }), "0.25");
    await waitFor(() => expect(valueOf(session, "kin", inputMapKind).deadzone).toBe(0.25));
  });

  it("Scenes sets the start, titles, sublevels, adds and removes (asking first)", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Scenes");
    const list = () => listOf(session);

    await act(async () => {
      fireEvent.click(await panel.findByRole("button", { name: "Add attic" }));
    });
    await waitFor(() => expect(list().scenes).toHaveLength(3));

    await commitText(panel.getByRole("textbox", { name: "attic title" }), "Attic");
    await waitFor(() =>
      expect(list().scenes).toEqual([
        { scene: "yard", title: "The Yard" },
        { scene: "cellar" },
        { scene: "attic", title: "Attic" },
      ]),
    );

    await act(async () => {
      fireEvent.click(panel.getByRole("switch", { name: "cellar is a sublevel" }));
    });
    await waitFor(() => expect(list().scenes[1]).toEqual({ scene: "cellar", sublevel: true }));
    expect(
      (panel.getByRole("radio", { name: "Start in cellar" }) as HTMLInputElement).disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(panel.getByRole("radio", { name: "Start in attic" }));
    });
    await waitFor(() => expect(list().start).toBe("attic"));

    await act(async () => {
      fireEvent.click(panel.getByRole("button", { name: "Remove yard from the list" }));
    });
    expect(await portal().findByText("Remove yard from the scene list?")).toBeTruthy();
    await confirmDialog();
    await waitFor(() => expect(sceneOrder(session)).toEqual(["cellar", "attic"]));
    expect(panel.getByRole("button", { name: "Add yard" })).toBeTruthy();
  });

  it("Scenes reorders by dragging a row onto another", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Scenes");
    const rows = await panel.findAllByRole("listitem");
    const handle = within(rows[0]!).getByRole("button", { name: "Drag yard" });
    const ROW = 40;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const li = this.closest("li");
        const i = li ? [...(li.parentElement?.children ?? [])].indexOf(li) : -1;
        return DOMRect.fromRect(i < 0 ? {} : { x: 0, y: i * ROW, width: 200, height: ROW });
      },
    );
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 10, clientY: 20, button: 0, isPrimary: true });
    });
    await act(async () => {
      fireEvent.pointerMove(document, { clientX: 10, clientY: 40 });
    });
    await act(async () => {
      fireEvent.pointerMove(document, { clientX: 10, clientY: ROW + 30 });
    });
    await act(async () => {
      fireEvent.pointerUp(document, { clientX: 10, clientY: ROW + 30 });
    });
    // dnd-kit swallows clicks for 50 ms after a drop.
    await act(() => new Promise((done) => setTimeout(done, 60)));
    vi.restoreAllMocks();
    await waitFor(() => expect(sceneOrder(session)).toEqual(["cellar", "yard"]));
  });

  it("offers Create for a project without one of its docs, from the kind's empty", async () => {
    const { session } = await client(project([INPUT_MAP_KIND]), ada);
    const panel = mount(session);
    await openTab(panel, "Input");
    await act(async () => {
      fireEvent.click(await panel.findByRole("button", { name: "Create input map" }));
    });
    await waitFor(() =>
      expect(
        [...session.view().byId.values()].filter((e) => e.kind === INPUT_MAP_KIND),
      ).toHaveLength(1),
    );
    const made = [...session.view().byId.values()].find((e) => e.kind === INPUT_MAP_KIND)!;
    await waitFor(() =>
      expect(
        layoutFromDoc(session.get(session.docNameFor(made)!)!.doc, layoutOf(inputMapKind)),
      ).toEqual(inputMapKind.empty()),
    );
    expect(await panel.findByRole("group", { name: "jump" })).toBeTruthy();
  });

  it("Create scene list lists every scene by path, the first as start, as one batch", async () => {
    const host = project([SCENE_LIST_KIND]);
    const { session } = await client(host, ada);
    const panel = mount(session);
    await openTab(panel, "Scenes");
    await act(async () => {
      fireEvent.click(await panel.findByRole("button", { name: "Create scene list" }));
    });
    const made = () => [...session.view().byId.values()].find((e) => e.kind === SCENE_LIST_KIND);
    await waitFor(() => expect(made()).toBeDefined());
    const name = session.docNameFor(made()!)!;
    await waitFor(() =>
      expect(layoutFromDoc(session.get(name)!.doc, layoutOf(sceneListKind))).toEqual({
        kind: SCENE_LIST_KIND,
        v: 1,
        start: "attic",
        scenes: [{ scene: "attic" }, { scene: "cellar" }, { scene: "yard" }],
      }),
    );
    await waitFor(() =>
      expect(readProjectLog(host.doc(`project:${PROJECT}`)).map((e) => e.label)).toEqual([
        "Create scene list",
      ]),
    );
    expect(await panel.findByRole("radio", { name: "Start in attic" })).toBeTruthy();
  });

  it("shows the edited doc in this client's presence while focus is inside it", async () => {
    const host = project();
    const { session } = await client(host, ada);
    const other = await client(host, bo);
    const scene = `scene:${PROJECT}.kyard`;
    setProjectPresence(session.awareness, {
      user: { id: "ada", name: "Ada", color: "#f05252" },
      doc: scene,
      mode: "edit",
    });
    const panel = mount(session);
    const lives = await panel.findByRole("textbox", { name: "game.lives" });
    const docOf = () => projectPeers(other.session.awareness).find((p) => p.user.id === "ada")?.doc;
    act(() => lives.focus());
    await waitFor(() => expect(docOf()).toBe(doc("kset")));
    act(() => lives.blur());
    await waitFor(() => expect(docOf()).toBe(scene));
  });
});

describe("the Layers section", () => {
  it("names each layer's and group's module, read-only", async () => {
    const { session } = await client(project(), ada);
    const panel = mount(session);
    await openTab(panel, "Layers");
    const layers = panel.getByRole("list", { name: "Layers" });
    expect(
      within(within(layers).getByRole("listitem", { name: "ground" })).getByText("src/yard.ts"),
    ).toBeTruthy();
    const groups = panel.getByRole("list", { name: "Collision groups" });
    expect(
      within(within(groups).getByRole("listitem", { name: "static" })).getByText("engine"),
    ).toBeTruthy();
    expect(
      within(within(groups).getByRole("listitem", { name: "player" })).getByText("src/yard.ts"),
    ).toBeTruthy();
    const section = panel.getByRole("tabpanel", { name: "Layers" });
    expect(within(section).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(within(section).queryAllByRole("switch")).toHaveLength(0);
  });

  it("takes a module the code map names for a layer or group over the game's module", () => {
    const code = {
      ...CODE,
      "src/layers.ts": { registers: { layers: ["actors"], collisionGroups: ["player"] } },
    } as Record<string, CodeModuleInfo>;
    expect(layerRows(registry, code).map((r) => [r.name, r.module])).toEqual([
      ["ground", "src/yard.ts"],
      ["actors", "src/layers.ts"],
    ]);
    expect(collisionGroupRows(registry, code).find((r) => r.name === "player")?.module).toBe(
      "src/layers.ts",
    );
    const plain = createRegistry(null);
    expect(layerRows(plain, {}).every((r) => r.engine && r.module === null)).toBe(true);
  });
});

describe("two editors on one project", () => {
  it("an input binding in one and a scene reorder in the other converge, each one history entry and one undo step for its author", async () => {
    const host = project();
    const a = await client(host, ada);
    const b = await client(host, bo);
    const atA = mount(a.session, async () => ({ device: "key", code: "KeyK" }));
    const atB = mount(b.session);
    await openTab(atA, "Input");
    await openTab(atB, "Scenes");
    await atA.findByRole("group", { name: "jump" });
    await atB.findByRole("button", { name: "Move yard down" });

    a.peer.setOnline(false);
    b.peer.setOnline(false);
    await act(async () => {
      fireEvent.click(
        within(atA.getByRole("group", { name: "jump" })).getByRole("button", {
          name: "Add binding",
        }),
      );
    });
    await act(async () => {
      fireEvent.click(atB.getByRole("button", { name: "Move yard down" }));
    });
    await waitFor(() => expect(valueOf(a.session, "kin", inputMapKind).actions).toHaveLength(1));
    await waitFor(() => expect(listOf(b.session).scenes[0]).toEqual({ scene: "cellar" }));
    act(() => {
      a.peer.setOnline(true);
      b.peer.setOnline(true);
    });

    const order = sceneOrder;
    const binds = (s: ProjectSession) => valueOf(s, "kin", inputMapKind).actions;
    await waitFor(() => expect(binds(b.session)).toEqual(binds(a.session)));
    await waitFor(() => expect(order(a.session)).toEqual(["cellar", "yard"]));
    expect(order(b.session)).toEqual(["cellar", "yard"]);
    expect(binds(a.session)).toEqual([
      {
        action: "jump",
        bindings: [
          { device: "key", code: "Space" },
          { device: "key", code: "KeyK" },
        ],
      },
    ]);

    for (const s of [a.session, b.session]) {
      const inputLog = readLog(s.get(doc("kin"))?.doc ?? (await s.open(doc("kin"))).doc);
      const listLog = readLog(s.get(doc("klist"))?.doc ?? (await s.open(doc("klist"))).doc);
      expect(inputLog.map((e) => e.actor)).toEqual([ada]);
      expect(listLog.map((e) => e.actor)).toEqual([bo]);
    }

    expect(a.session.undoLabel()).toBe("Bind K to jump");
    act(() => void a.session.undo());
    expect(a.session.canUndo()).toBe(false);
    expect(binds(a.session)).toBeUndefined();
    await waitFor(() => expect(binds(b.session)).toBeUndefined());
    expect(order(a.session)).toEqual(["cellar", "yard"]);
    expect(b.session.canUndo()).toBe(true);
    act(() => void b.session.undo());
    await waitFor(() => expect(order(a.session)).toEqual(["yard", "cellar"]));
    expect(b.session.canUndo()).toBe(false);
  });
});
