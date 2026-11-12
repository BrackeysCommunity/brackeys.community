// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  layoutFromDoc,
  layoutToDoc,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type MemoryDocHost,
  type ProjectSession,
} from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import {
  createKindRegistry,
  GAME_SETTINGS_KIND,
  gameSettingsKind,
  SCENE_LIST_KIND,
  sceneListKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/index";
import type { EditorNotify } from "../host";
import { KitProvider } from "../kit/index";
import { DEFAULT_LAYOUT, resizeSplit, selectTab } from "../layout/model";
import { ProjectSettings } from "../panels/settings/ProjectSettings";
import { createPending, type Pending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import type { EditorProjectLink } from "../session/use-scene-editor";

const game = defineGame({
  id: "yard",
  types: [],
  actions: [],
  world: { lengthUnit: 32 },
  resolution: { virtual: { width: 576, height: 384 } },
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);
const kinds = createKindRegistry(game);
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
const LIST = entry("klist", "scene-list", SCENE_LIST_KIND, "scene-list.json");
const doc = (key: string) => `asset:${PROJECT}.${key}`;
const layoutOf = (kind: { layout: unknown }) => kind.layout as DocLayout;

function project(engine: Record<string, unknown> = {}) {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc(`project:${PROJECT}`),
    {
      meta: { projectId: PROJECT, layout: 1, name: "Yard" },
      assets: Object.fromEntries([...SCENES, SETTINGS, LIST].map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of SCENES)
    sceneToDoc(
      {
        v: SCENE_FORMAT_VERSION,
        game: "yard",
        name: e.id,
        bounds: [0, 0, 20, 12],
        entities: [],
      } as SceneDefinition,
      { doc: host.doc(`scene:${PROJECT}.${e.key}`), key: sequentialKeys(e.id) },
    );
  layoutToDoc(host.doc(doc("kset")), layoutOf(gameSettingsKind), {
    kind: GAME_SETTINGS_KIND,
    v: 2,
    engine,
    game: {},
  });
  layoutToDoc(host.doc(doc("klist")), layoutOf(sceneListKind), {
    kind: SCENE_LIST_KIND,
    v: 1,
    start: "yard",
    scenes: [{ scene: "yard" }, { scene: "cellar" }],
  });
  return host;
}

const sessions: ProjectSession[] = [];
async function client(host: MemoryDocHost) {
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: { kind: "user", userId: "ada", name: "Ada" },
    registry,
    kinds,
  });
  sessions.push(session);
  return session;
}

const notify: EditorNotify = Object.assign(vi.fn(), {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
});

function mount(session: ProjectSession, pending?: Pending) {
  const link: EditorProjectLink = { session, doc: `scene:${PROJECT}.kyard`, scene: "yard" };
  const panel = <ProjectSettings project={link} notify={notify} capture={null} />;
  const view = render(
    <KitProvider host={{ storage: null }}>
      {pending ? <PendingProvider pending={pending}>{panel}</PendingProvider> : panel}
    </KitProvider>,
  );
  return { panel: within(view.container), view };
}

async function openTab(panel: ReturnType<typeof within>, name: string) {
  const tab = panel.getByRole("tab", { name });
  await act(async () => {
    fireEvent.click(tab);
  });
}

const engineOf = (session: ProjectSession) =>
  (layoutFromDoc(session.get(doc("kset"))!.doc, layoutOf(gameSettingsKind)) as { engine: object })
    .engine;

async function commit(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
  vi.restoreAllMocks();
});

describe("the Engine section", () => {
  it("lists physics, gravity and tick rate before the resolution", async () => {
    const { panel } = mount(await client(project()));
    await openTab(panel, "Engine");
    await panel.findByRole("group", { name: "engine.physics" });
    const titles = panel
      .getByRole("tabpanel")
      .querySelectorAll(".je-insp-field-title, .je-insp-nested-title");
    expect([...titles].slice(0, 5).map((t) => t.textContent)).toEqual([
      "Physics",
      "Gravity",
      "Tick rate",
      "Resolution",
      "Virtual",
    ]);
  });

  it("edits the virtual resolution as a width and a height, either left blank", async () => {
    const session = await client(project());
    const { panel } = mount(session);
    await openTab(panel, "Engine");
    const width = await panel.findByRole("textbox", { name: "engine.resolution.virtual.width" });
    const height = panel.getByRole("textbox", { name: "engine.resolution.virtual.height" });
    expect((width as HTMLInputElement).placeholder).toBe("576");
    expect((height as HTMLInputElement).placeholder).toBe("384");
    expect(panel.queryByText(/"width"/)).toBeNull();

    await commit(width, "640");
    await waitFor(() =>
      expect(engineOf(session)).toEqual({ resolution: { virtual: { width: 640, height: 384 } } }),
    );
    await commit(height, "");
    await waitFor(() =>
      expect(engineOf(session)).toEqual({ resolution: { virtual: { width: 640 } } }),
    );
    expect((height as HTMLInputElement).value).toBe("");
    expect((width as HTMLInputElement).value).toBe("640");

    await commit(width, "-4");
    expect(await panel.findByText(/^width: /)).toBeTruthy();
    expect(engineOf(session)).toEqual({ resolution: { virtual: { width: 640 } } });
  });
});

describe("the settings tabs", () => {
  it("come back on the section shown last when the panel mounts again on the same project", async () => {
    const session = await client(project());
    const first = mount(session);
    await openTab(first.panel, "Scenes");
    first.view.unmount();
    const again = mount(session);
    expect(again.panel.getByRole("tab", { name: "Scenes" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("wrap their strip rather than cut a section off", async () => {
    const { panel } = mount(await client(project()));
    const strip = panel.getByRole("tablist", { name: "Project settings sections" });
    expect(strip.closest(".je-settings-tabs")).toBeTruthy();
  });
});

describe("the Scenes section", () => {
  it("names a not-listed scene once, its add button plainly Add", async () => {
    const { panel } = mount(await client(project()));
    await openTab(panel, "Scenes");
    const add = await panel.findByRole("button", { name: "Add attic" });
    expect(add.textContent).toBe("Add");
  });

  it("draws the start choice and the drag handle with the editor's kit", async () => {
    const { panel } = mount(await client(project()));
    await openTab(panel, "Scenes");
    const radio = await panel.findByRole("radio", { name: "Start in yard" });
    expect(radio.className).toContain("je-radio");
    const handle = panel.getByRole("button", { name: "Drag yard" });
    expect(handle.getAttribute("data-size")).toBe("icon-xs");
    const moves = panel.getByRole("button", { name: "Move yard down" }).parentElement!;
    expect(moves.closest(".je-insp-wrap")).toBeTruthy();
  });

  it("locks a row's controls and shows a spinner while a list edit lands", async () => {
    const pending = createPending({ notify });
    const session = await client(project());
    const { panel } = mount(session, pending);
    await openTab(panel, "Scenes");
    const down = (await panel.findByRole("button", {
      name: "Move yard down",
    })) as HTMLButtonElement;
    expect(down.disabled).toBe(false);
    const name = session.docNameFor(LIST);
    let release = () => {};
    act(() => {
      release = pending.hold({ id: "t", label: "Move", scope: `settings:${name}:scenes` });
    });
    const rows = panel.getAllByRole("listitem");
    expect(rows[0]!.getAttribute("aria-busy")).toBe("true");
    expect(rows[0]!.querySelector(".je-insp-field-label .je-spinner")).toBeTruthy();
    expect(down.disabled).toBe(true);
    expect(
      (panel.getByRole("radio", { name: "Start in cellar" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      panel.getByRole("switch", { name: "cellar is a sublevel" }).hasAttribute("data-disabled"),
    ).toBe(true);
    act(() => release());
    await waitFor(() => expect(down.disabled).toBe(false));
    expect(rows[0]!.hasAttribute("aria-busy")).toBe(false);
  });

  it("moves the dragged row with the pointer and marks where it drops", async () => {
    const { panel } = mount(await client(project()));
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
    expect(rows[0]!.hasAttribute("data-dragging")).toBe(true);
    expect(rows[0]!.style.transform).toContain(`${ROW + 10}px`);
    expect(rows[1]!.getAttribute("data-over")).toBe("after");
    await act(async () => {
      fireEvent.pointerUp(document, { clientX: 10, clientY: ROW + 30 });
    });
  });
});

describe("the settings panel's group", () => {
  it("grows a short bottom group when Project settings is picked there, and lets the viewer shrink it again", () => {
    const picked = selectTab(DEFAULT_LAYOUT, "settings");
    const bottom = picked.left.groups[1]!;
    expect(bottom.active).toBe("settings");
    expect(bottom.size).toBe(480);
    const shrunk = resizeSplit(picked, "left", 300);
    expect(shrunk.left.groups[1]!.size).toBe(300);
    expect(selectTab(picked, "project").left.groups[1]!.size).toBe(480);
    expect(selectTab(DEFAULT_LAYOUT, "run").right.groups[1]!.size).toBe(240);
  });
});
