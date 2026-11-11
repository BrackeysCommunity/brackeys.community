// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type SceneOrigin,
} from "../../collab/index";
import {
  createEditorSession,
  type EditorSession,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createRegistry, defineEntityType, defineGame, shapeField } from "../../game/index";
import type { AssetKey } from "../../project/index";
import { prefabLibrary, SCENE_FORMAT_VERSION } from "../../scene/index";
import { PanelGroup } from "../frame/PanelGroup";
import type { EditorNotify, EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import type { Viewport } from "../layout/model";
import { useLayout } from "../layout/use-layout";
import { EditorInspector } from "../panels/EditorInspector";
import { EditorOutliner } from "../panels/EditorOutliner";
import { createPanelContext, PANEL_IDS, type PanelContext } from "../panels/registry";
import { createPending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import { openPrefabScope } from "../session/live-scene-editor";
import type { LoadedRun } from "../session/loaded-run";

const registry = createRegistry(
  defineGame({
    id: "density",
    behaviors: [],
    types: [
      defineEntityType({
        type: "plank",
        description: "A board to stand on.",
        base: "solid",
        fields: {
          shape: shapeField("Its outline."),
          power: z.number().int().min(0).describe("How hard it pushes."),
          friction: z.number().min(0).describe("Grip.").meta({ group: "physics" }),
        },
      }),
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const prefabs = prefabLibrary([
  {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    game: "density",
    id: "deck",
    entities: [{ id: "p", type: "plank", shape: ["box", 0, 0, 40, 8], power: 1, friction: 0.5 }],
  },
]);

const yard: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "density",
  name: "density-yard",
  bounds: [0, 0, 2000, 1200],
  instances: [{ id: "deck-1", prefab: "deck", at: [800, 400] }],
  entities: [
    { id: "plank", type: "plank", shape: ["box", 100, 100, 80, 10], power: 2, friction: 0.4 },
  ],
};

function sessionOf(selection: string[] = []) {
  const session = createEditorSession({
    doc: sceneToDoc(yard, { key: sequentialKeys("t") }),
    origin: ada,
    name: yard.name,
    registry,
    prefabs: staticPrefabSource(prefabs),
    issuesDebounceMs: 0,
  });
  session.select(selection);
  return session;
}

function memoryStorage(): EditorStorage {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const fakeNotify = (): EditorNotify =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("inspector sections", () => {
  const toggle = (title: string) =>
    screen.getByRole("region", { name: title }).querySelector("summary")!;
  const expanded = (title: string) => toggle(title).closest("details")!.open;

  it("collapse from their title and stay collapsed, per section, after a remount", () => {
    const storage = memoryStorage();
    const mount = () =>
      render(
        <KitProvider host={{ storage }}>
          <EditorInspector session={sessionOf(["plank"])} />
        </KitProvider>,
      );
    mount();
    expect(screen.getByLabelText("friction")).toBeTruthy();
    expect(expanded("Physics")).toBe(true);

    fireEvent.click(toggle("Physics"));
    expect(expanded("Physics")).toBe(false);
    expect(screen.queryByLabelText("friction")).toBeNull();
    expect(screen.getByLabelText("power")).toBeTruthy();

    cleanup();
    mount();
    expect(expanded("Physics")).toBe(false);
    expect(screen.queryByLabelText("friction")).toBeNull();
    expect(expanded("Gameplay")).toBe(true);

    fireEvent.click(toggle("Physics"));
    expect(screen.getByLabelText("friction")).toBeTruthy();
    cleanup();
    mount();
    expect(screen.getByLabelText("friction")).toBeTruthy();
  });

  it("still collapse in a read-only inspector", () => {
    render(
      <KitProvider host={{ storage: memoryStorage() }}>
        <EditorInspector session={sessionOf(["plank"])} readOnly />
      </KitProvider>,
    );
    expect(screen.getByLabelText("power").matches(":disabled")).toBe(true);
    fireEvent.click(toggle("Gameplay"));
    expect(screen.queryByLabelText("power")).toBeNull();
  });

  it("put the type line and Create prefab in the header's one row", () => {
    render(<EditorInspector session={sessionOf(["plank"])} />);
    const head = screen.getByLabelText("Inspector").querySelector("header")!;
    expect(within(head).getByText("plank", { selector: ".je-insp-muted" })).toBeTruthy();
    expect(within(head).getByRole("button", { name: "Create prefab" })).toBeTruthy();
  });
});

describe("the inspector's label column", () => {
  function observeWidths() {
    const observers: { callback: () => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(readonly callback: () => void) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        disconnect() {
          this.targets = [];
        }
      },
    );
    let width = 320;
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    spy.mockImplementation(() => width);
    return (next: number) => {
      width = next;
      act(() => {
        for (const o of observers) if (o.targets.length > 0) o.callback();
      });
    };
  }

  it("follows the panel's width, from 64 px up to 120 px", () => {
    const resize = observeWidths();
    render(<EditorInspector session={sessionOf(["plank"])} />);
    const panel = screen.getByLabelText("Inspector");
    const column = () => panel.style.getPropertyValue("--je-label-col");
    expect(column()).toBe("96px");
    resize(360);
    expect(column()).toBe("108px");
    resize(560);
    expect(column()).toBe("120px");
    resize(180);
    expect(column()).toBe("64px");
    vi.restoreAllMocks();
  });

  it("sizes an instance's fields the same way", () => {
    observeWidths();
    render(<EditorInspector session={sessionOf(["deck-1"])} />);
    expect(screen.getByLabelText("Inspector").style.getPropertyValue("--je-label-col")).toBe(
      "96px",
    );
    vi.restoreAllMocks();
  });

  it("widens to fit its longest title, up to 45% of the panel", () => {
    const resize = observeWidths();
    let titleWidth = 0;
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!;
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("je-insp-field-title")
          ? titleWidth
          : (original.get!.call(this) as number);
      },
    );
    titleWidth = 87.4;
    render(<EditorInspector session={sessionOf(["plank"])} />);
    const panel = screen.getByLabelText("Inspector");
    const column = () => panel.style.getPropertyValue("--je-label-col");
    resize(250);
    expect(column()).toBe("88px");
    resize(180);
    expect(column()).toBe("81px");
    titleWidth = 40;
    resize(320);
    expect(column()).toBe("96px");
    vi.restoreAllMocks();
  });
});

describe("the inspector with nothing selected", () => {
  const VIEWPORT: Viewport = { width: 1440, height: 900, topLeft: 48, topRight: 0, bottom: 40 };

  function contextFor(session: EditorSession): PanelContext {
    return createPanelContext({
      openPanel: vi.fn(),
      controls: {
        session,
        notify: fakeNotify(),
        runStore: new Store<LoadedRun | null>(null),
        playFrom: vi.fn(),
        onReplay: vi.fn(),
        frame: () => true,
      },
      physical: new Store<readonly SceneIssue[]>([]),
      pickedAsset: new Store<AssetKey | null>(null),
    });
  }

  function RightColumn({ ctx }: { ctx: PanelContext }) {
    const layout = useLayout(memoryStorage(), PANEL_IDS);
    return <PanelGroup side="right" index={0} layout={layout} viewport={VIEWPORT} ctx={ctx} />;
  }

  it("is one muted line in the group's body, not an island of its own", () => {
    render(
      <KitProvider host={{ storage: memoryStorage() }}>
        <PendingProvider pending={createPending({ notify: fakeNotify() })}>
          <RightColumn ctx={contextFor(sessionOf())} />
        </PendingProvider>
      </KitProvider>,
    );
    const body = screen.getByRole("tabpanel", { name: "Inspector" });
    expect(body.children).toHaveLength(1);
    const line = body.firstElementChild!;
    expect(line.tagName).toBe("P");
    expect(line.getAttribute("data-tone")).toBe("muted");
    expect(line.textContent).toBe("Select something in the scene or the outliner.");
    expect(body.querySelector(".je-island")).toBeNull();
  });
});

describe("the outliner's density", () => {
  it("names its filter Filter and gives the syntax in a hint", async () => {
    render(<EditorOutliner session={sessionOf()} />);
    const filter = screen.getByRole("searchbox", { name: "Filter rows" }) as HTMLInputElement;
    expect(filter.placeholder).toBe("Filter");
    await act(async () => {
      fireEvent.focus(filter);
    });
    expect(
      (await screen.findByText(/type:sensor, shape:box and has:problems/)).textContent,
    ).toMatch(/Words match ids and names/);
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("keeps Type and Layer in its body toolbar", () => {
    render(<EditorOutliner session={sessionOf()} />);
    const toolbar = screen.getByRole("navigation", { name: "Outliner" }).firstElementChild!;
    expect(toolbar.classList.contains("je-panel-toolbar")).toBe(true);
    expect(
      within(toolbar as HTMLElement).getByRole("group", { name: "Group rows by" }),
    ).toBeTruthy();
  });

  it("shows an instance's row and Open prefab busy while its prefab opens", async () => {
    const pending = createPending({ notify: fakeNotify() });
    const session = sessionOf(["deck-1"]);
    let release!: () => void;
    const opening = new Promise<void>((resolve) => (release = resolve));
    const onOpenPrefab = vi.fn((prefab: string, from: string) => {
      void pending.run(
        {
          id: `prefab:open:${prefab}`,
          label: `Opening ${prefab}`,
          scope: openPrefabScope(from),
          error: "Couldn't open the prefab",
        },
        () => opening,
      );
    });
    render(
      <PendingProvider pending={pending}>
        <EditorOutliner session={session} onOpenPrefab={onOpenPrefab} />
        <EditorInspector session={session} onOpenPrefab={onOpenPrefab} />
      </PendingProvider>,
    );
    const row = () => screen.getByRole("button", { name: /^deck-1/ });
    const open = () => screen.getByRole("button", { name: "Open prefab deck" });
    const inspectorOpen = () =>
      within(screen.getByLabelText("Inspector")).getByRole("button", { name: "Open prefab" });
    expect(row().getAttribute("aria-busy")).toBeNull();

    act(() => {
      fireEvent.click(inspectorOpen());
    });
    expect(onOpenPrefab).toHaveBeenCalledWith("deck", "deck-1");
    expect(row().getAttribute("aria-busy")).toBe("true");
    expect(open().getAttribute("aria-busy")).toBe("true");
    expect(inspectorOpen().getAttribute("aria-busy")).toBe("true");

    fireEvent.click(open());
    expect(onOpenPrefab).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(row().getAttribute("aria-busy")).toBeNull();
    expect(open().getAttribute("aria-busy")).toBeNull();
  });
});
