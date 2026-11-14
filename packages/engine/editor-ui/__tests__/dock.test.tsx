// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import {
  createEditorSession,
  createKeymap,
  defineEditorTool,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createToolHost } from "../../editor/tool-host";
import { DEFAULT_SNAP } from "../../editor/tools";
import { createRegistry } from "../../game/index";
import type { AssetKey } from "../../project/index";
import { createToolRouter } from "../../tool-router";
import {
  bottomRow,
  EditorFrame,
  editorChrome,
  Island,
  useBottomRow,
  type FramePanels,
} from "../frame/EditorFrame";
import type { EditorNotify } from "../host";
import { DEFAULT_LAYOUT, fitLayout, type Viewport } from "../layout/model";
import { EditorStatusBar } from "../panels/EditorStatusBar";
import {
  dockParts,
  dockWidth,
  EditorToolbar,
  fitDock,
  narrowed,
  optionSlot,
  overflows,
} from "../panels/EditorToolbar";
import { ACTIVITY_DELAY_MS, createPending, type PendingStep } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import type { EditorHostState } from "../session/live-scene-editor";
import type { LoadedRun } from "../session/loaded-run";
import { fakeWorldGame } from "./fake-world-game";

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

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

/** `pad` sits half a pixel off the grid: one warning for the status to count. */
const scene: SceneDefinition = {
  v: 1,
  name: "dock-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "pad", type: "marker", at: [1000.005, 1010] }],
};

const gameTool = (id: string, label: string) =>
  defineEditorTool({ id, label, description: label, create: () => ({}) });

const GAME_TOOLS = [gameTool("constructs", "Constructs"), gameTool("springs", "Spring pads")];

function resizeWindow(width: number, height = 900) {
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event("resize"));
  });
}

const viewportOf = (width: number, height = 900): Viewport => ({
  width,
  height,
  topLeft: 0,
  topRight: 0,
  bottom: 0,
});

/** The bottom row's inner width at `width`: the canvas between the columns, less its padding. */
const rowAt = (width: number) => {
  const { canvas } = fitLayout(DEFAULT_LAYOUT, viewportOf(width));
  return width - canvas.left - canvas.right - 16;
};

function setup() {
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "dock-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  const tools = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    gameTools: GAME_TOOLS,
    snap: DEFAULT_SNAP,
  });
  const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
  const keymap = createKeymap([
    { key: "9", scope: "edit", command: "tool:constructs", description: "Constructs" },
  ]);
  const onPlay = vi.fn();
  render(
    <EditorFrame
      dock={
        <Island>
          <EditorToolbar
            session={session}
            keymap={keymap}
            host={tools}
            onPlay={onPlay}
            onPlayHere={vi.fn()}
          />
        </Island>
      }
      status={
        <Island>
          <EditorStatusBar session={session} host={host} />
        </Island>
      }
    >
      <canvas />
    </EditorFrame>,
  );
  return { session, tools, onPlay, host };
}

const toolbar = () => screen.getByRole("toolbar", { name: "Editor" });
const status = () => document.querySelector<HTMLElement>(".je-status")!;

beforeEach(() => resizeWindow(1440));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the dock's fit", () => {
  const parts = dockParts(
    [
      ...["select", "pan", "box", "circle", "pen", "waypoints", "rotate"].map((id) =>
        gameTool(id, id),
      ),
      ...GAME_TOOLS,
    ],
    16,
  );

  it("moves game tools out first, last first, then the grid step, then the shape tools", () => {
    const full = dockWidth(parts, new Set());
    expect(fitDock(parts, full).size).toBe(0);
    expect([...fitDock(parts, full - 1)]).toEqual(["tool:springs"]);
    const noGame = dockWidth(parts, new Set(["tool:springs", "tool:constructs"]));
    expect([...fitDock(parts, noGame)]).toEqual(["tool:springs", "tool:constructs"]);
    expect([...fitDock(parts, noGame - 1)]).toEqual(["tool:springs", "tool:constructs", "step"]);
    const least = [...fitDock(parts, 0)];
    expect(least).not.toContain("tool:select");
    expect(least).not.toContain("tool:pan");
    expect(least.slice(3)).toEqual([
      "tool:rotate",
      "tool:waypoints",
      "tool:pen",
      "tool:circle",
      "tool:box",
    ]);
  });

  it("only ever narrows as the room does", () => {
    let last = Infinity;
    for (let room = 700; room >= 0; room -= 10) {
      const width = dockWidth(parts, fitDock(parts, room));
      expect(width).toBeLessThanOrEqual(last);
      last = width;
    }
  });

  const long = { choices: [{ label: "solid" }, { label: "camera-region" }] };
  const tools = [gameTool("select", "select"), gameTool("box", "box"), ...GAME_TOOLS];

  it("narrows the option slot to a few glyphs before anything moves into More tools", () => {
    const slotted = dockParts(tools, 16, long);
    const slot = slotted.find((p) => p.key === "option")!;
    expect(slot.narrow).toBeLessThan(slot.width);
    const full = dockWidth(slotted, new Set());
    const shrunk = fitDock(slotted, full - 1);
    expect([...shrunk]).toEqual([narrowed("option")]);
    expect(overflows(shrunk)).toBe(false);
    expect(dockWidth(slotted, shrunk)).toBe(full - slot.width + slot.narrow!);
    expect([...fitDock(slotted, dockWidth(slotted, shrunk) - 1)]).toEqual([
      narrowed("option"),
      "tool:springs",
    ]);
  });

  it("keeps room for the shown choice when it is longer than the narrow slot", () => {
    const short = dockParts(tools, 16, { ...long, shown: "solid" }).find(
      (p) => p.key === "option",
    )!;
    const picked = dockParts(tools, 16, { ...long, shown: "camera-region" }).find(
      (p) => p.key === "option",
    )!;
    expect(short.narrow).toBeLessThan(short.width);
    expect(picked.narrow).toBe(picked.width);
    const slotted = dockParts(tools, 16, { ...long, shown: "camera-region" });
    expect(fitDock(slotted, dockWidth(slotted, new Set()) - 1).has(narrowed("option"))).toBe(false);
  });

  it("takes the active tool's choice as the one shown", () => {
    const registry = createRegistry();
    const option = {
      label: "Draw type",
      command: "type:",
      value: "sensor",
      choices: [
        { value: "solid", label: "solid" },
        { value: "sensor", label: "sensor" },
      ],
    };
    expect(optionSlot(tools, registry, option)?.shown).toBe("sensor");
    expect(optionSlot(tools, registry, null)?.shown).toBeUndefined();
  });
});

describe("the dock in the frame", () => {
  it("draws every tool at 1440, Play and Play from here as icon buttons with key hints", async () => {
    const { onPlay } = setup();
    const bar = within(toolbar());
    expect(bar.getByRole("button", { name: "Constructs" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Spring pads" })).toBeTruthy();
    expect(bar.queryByRole("button", { name: "More tools" })).toBeNull();

    const play = bar.getByRole("button", { name: "Play" });
    expect(play.textContent).toBe("");
    expect(bar.getByRole("button", { name: "Play from here" }).textContent).toBe("");
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledOnce();

    act(() => play.focus());
    const hint = await screen.findByText("Play from spawn");
    expect(hint.closest(".je-key-hint")?.querySelector(".je-hotkey")).toBeTruthy();
  });

  it("keeps the idle draw type slot at its widest choice where the row has room, narrower at 1440", () => {
    const slotWidth = () =>
      within(toolbar()).getByRole("button", { name: /^Draw type/ }).style.minWidth;
    const { tools, session } = setup();
    const atLaptop = slotWidth();
    cleanup();
    resizeWindow(2400);
    setup();
    const slot = dockParts(
      tools.tools(),
      DEFAULT_SNAP.step,
      optionSlot(tools.tools(), session.registry, null),
    ).find((p) => p.key === "option")!;
    expect(slotWidth()).toBe(`${slot.width}px`);
    expect(atLaptop).toBe(`${slot.narrow}px`);
  });

  it("moves game tools into the overflow menu when the canvas is narrower than they need", async () => {
    resizeWindow(1024);
    const { tools } = setup();
    const bar = within(toolbar());
    const room = rowAt(1024);
    const all = dockParts(tools.tools(), DEFAULT_SNAP.step);
    expect(dockWidth(all, new Set())).toBeGreaterThan(room);

    expect(bar.queryByRole("button", { name: "Constructs" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Spring pads" })).toBeNull();
    expect(bar.getByRole("button", { name: "Select" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.click(bar.getByRole("button", { name: "More tools" }));
    const constructs = await screen.findByRole("menuitemradio", { name: /Constructs/ });
    expect(constructs.querySelector(".je-hotkey")).toBeTruthy();
    fireEvent.click(constructs);
    expect(tools.tool()).toBe("constructs");
  });

  it("brings the tools back when the window widens again", () => {
    resizeWindow(1024);
    setup();
    expect(within(toolbar()).queryByRole("button", { name: "Constructs" })).toBeNull();
    resizeWindow(1440);
    expect(within(toolbar()).getByRole("button", { name: "Constructs" })).toBeTruthy();
    expect(within(toolbar()).queryByRole("button", { name: "More tools" })).toBeNull();
  });

  it("keeps the shape tools and the grid step behind More tools at 760, the toolbar inside the row", () => {
    resizeWindow(760);
    const { tools } = setup();
    const bar = within(toolbar());
    expect(bar.getByRole("button", { name: "Select" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Pan" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "More tools" })).toBeTruthy();
    const drawn = new Set(bar.getAllByRole("button").map((b) => b.getAttribute("aria-label")));
    const hidden = new Set(
      tools
        .tools()
        .filter((t) => !drawn.has(t.label))
        .map((t) => `tool:${t.id}`),
    );
    expect(hidden).toEqual(
      new Set([
        "tool:constructs",
        "tool:springs",
        "tool:rotate",
        "tool:waypoints",
        "tool:pen",
        "tool:circle",
      ]),
    );
    expect([...drawn].some((l) => l?.startsWith("Grid step"))).toBe(false);
    hidden.add("step");
    const shown = dockParts(tools.tools(), DEFAULT_SNAP.step);
    expect(dockWidth(shown, hidden)).toBeLessThanOrEqual(rowAt(760));
  });
});

describe("the status in the bottom row", () => {
  it("names the scene, its save state and its warnings when the row has room", async () => {
    resizeWindow(1600);
    setup();
    await waitFor(() => expect(status().textContent).toContain("1 warning"));
    expect(status().hasAttribute("data-compact")).toBe(false);
    expect(within(status()).getByText("dock-yard")).toBeTruthy();
    expect(within(status()).getByText("Saved")).toBeTruthy();
    expect(within(status()).getByText("Just you").className).toBe("je-sr-only");
  });

  it("draws a dot and counts when the row is short, keeping the words for screen readers", async () => {
    resizeWindow(1024);
    setup();
    await waitFor(() => expect(document.querySelector(".je-status-count")).toBeTruthy());
    const row = status();
    expect(row.hasAttribute("data-compact")).toBe(true);
    expect(row.querySelector(".je-status-dot")?.getAttribute("data-tone")).toBe("success");
    const count = row.querySelector<HTMLElement>(".je-status-count")!;
    expect(count.getAttribute("data-tone")).toBe("warning");
    expect(count.querySelector("[aria-hidden]:not(svg)")?.textContent).toBe("1");
    expect(within(row).getByText("1 warning").className).toBe("je-sr-only");
    expect(within(row).getByText("Saved").closest(".je-sr-only")).toBeTruthy();
    expect(within(row).getByText("dock-yard").className).toBe("je-sr-only");
    expect(row.querySelector(".je-save-state-short")).toBeNull();
  });

  it("names a dropped connection in a short word beside the dot when the row is short", async () => {
    resizeWindow(1024);
    const { host } = setup();
    act(() => host.setState((s) => ({ ...s, connection: "reconnecting", unsynced: 1 })));
    await waitFor(() => expect(status().hasAttribute("data-compact")).toBe(true));
    const save = status().querySelector<HTMLElement>(".je-save-state[data-compact]")!;
    expect(save.querySelector(".je-status-dot")?.getAttribute("data-tone")).toBe("warning");
    expect(save.querySelector(".je-save-state-short")?.textContent).toBe("Retrying");
    expect(within(save).getByText("Reconnecting…").className).toBe("je-sr-only");
  });
});

describe("the Problems count off the tab strip", () => {
  function framed(width: number) {
    resizeWindow(width, 800);
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "dock-yard",
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    const physical = new Store<readonly SceneIssue[]>([]);
    const panels: FramePanels = {
      context: {
        controls: {
          session,
          notify,
          runStore: new Store<LoadedRun | null>(null),
          playFrom: vi.fn(),
          onReplay: vi.fn(),
          frame: () => true,
        },
        physical,
        pickedAsset: new Store<AssetKey | null>(null),
      },
    };
    render(
      <EditorFrame host={{ storage: null }} panels={panels} dock={<Island>dock</Island>}>
        <canvas />
      </EditorFrame>,
    );
    return { session, physical };
  }

  const badgeOf = (button: HTMLElement) =>
    button.closest(".je-rail-item")?.querySelector<HTMLElement>(".je-rail-badge") ?? null;

  it("shows the phone bar's Problems button with its count and tone, and drops it at zero", async () => {
    const { session, physical } = framed(500);
    const bar = screen.getByRole("navigation", { name: "Right panels" });
    const problems = await within(bar).findByRole("button", { name: "Problems (1)" });
    expect(badgeOf(problems)?.textContent).toBe("1");
    expect(badgeOf(problems)?.getAttribute("data-tone")).toBe("warning");
    expect(badgeOf(problems)?.getAttribute("aria-hidden")).toBe("true");
    expect(badgeOf(within(bar).getByRole("button", { name: "Run" }))).toBeNull();

    act(() =>
      physical.setState(() => [
        {
          severity: "error",
          code: "spawn-in-solid" as SceneIssue["code"],
          message: "pad overlaps the ground",
          entityIds: ["pad"],
        },
      ]),
    );
    const both = within(bar).getByRole("button", { name: "Problems (2)" });
    expect(badgeOf(both)?.getAttribute("data-tone")).toBe("danger");

    act(() => physical.setState(() => []));
    const [rounding] = session.store.state.issues;
    act(() => {
      session.dispatch(rounding!.fix!);
    });
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Problems" })).toBeTruthy());
    expect(badgeOf(within(bar).getByRole("button", { name: "Problems" }))).toBeNull();
  });

  it("opens the Problems sheet from the badged button", async () => {
    framed(500);
    const bar = screen.getByRole("navigation", { name: "Right panels" });
    fireEvent.click(await within(bar).findByRole("button", { name: "Problems (1)" }));
    const sheet = document.querySelector<HTMLElement>(".je-frame-sheet")!;
    expect(
      within(sheet)
        .getByRole("tab", { name: /Problems/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("badges a single-column layout's rail too", async () => {
    framed(760);
    const left = screen.getByRole("navigation", { name: "Left panels" });
    fireEvent.click(within(left).getByRole("button", { name: "Outliner" }));
    const rail = screen.getByRole("navigation", { name: "Right panels" });
    const problems = await within(rail).findByRole("button", { name: "Problems (1)" });
    expect(badgeOf(problems)?.textContent).toBe("1");
    expect(badgeOf(within(rail).getByRole("button", { name: "Inspector" }))).toBeNull();
  });
});

describe("sharing the bottom row with a running activity", () => {
  const dock = { full: 535, least: 220 };
  const words = { full: 229, least: 60 };

  it("keeps the status's words beside the whole dock while nothing runs", () => {
    expect(bottomRow(816, { dock, status: words }, true)).toEqual({
      dock: 816 - 229 - 8,
      compactStatus: false,
      status: Infinity,
    });
  });

  it("takes a running activity's room from the dock's tools before the status's words", () => {
    const activity = { full: 260, least: 120 };
    const row = bottomRow(816, { dock, status: { ...words, activity } }, true);
    expect(row.compactStatus).toBe(false);
    expect(row.status).toBe(229 + 260);
    expect(row.dock).toBe(816 - 229 - 260 - 8);
    expect(row.dock).toBeGreaterThanOrEqual(dock.least);
  });

  it("cuts the activity short once the dock is at its least, then gives way the words", () => {
    const activity = { full: 400, least: 120 };
    const short = bottomRow(800, { dock, status: { ...words, activity } }, true);
    expect(short.compactStatus).toBe(false);
    expect(short.status).toBe(800 - 8 - dock.least);
    expect(short.dock).toBe(dock.least);

    const wideDock = { full: 535, least: 500 };
    const shorter = bottomRow(800, { dock: wideDock, status: { ...words, activity } }, true);
    expect(shorter.compactStatus).toBe(true);
    expect(shorter.status).toBe(800 - 8 - wideDock.least);
    expect(shorter.status).toBeGreaterThanOrEqual(words.least + activity.least);
  });

  function FixedDock() {
    const { dock: room } = useBottomRow("dock", dock);
    return (
      <Island>
        <span data-room={room}>dock</span>
      </Island>
    );
  }

  it("shows a running import's label and count at the site's 816 px row beside a 535 px dock", () => {
    vi.useFakeTimers();
    // The default columns take 624 px and the row's padding 16: an 816 px row.
    resizeWindow(816 + 624 + 16);
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "dock-yard",
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    const say = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });
    const pending = createPending({ notify: say as EditorNotify });
    render(
      <PendingProvider pending={pending}>
        <EditorFrame
          dock={<FixedDock />}
          status={
            <Island>
              <EditorStatusBar session={session} host={host} />
            </Island>
          }
        >
          <canvas />
        </EditorFrame>
      </PendingProvider>,
    );
    let step!: PendingStep;
    act(
      () =>
        void pending.run(
          { label: "Reading review-big-2.png", scope: "project:import", total: 5, error: "x" },
          (s) => {
            step = s;
            return new Promise(() => {});
          },
        ),
    );
    act(() => step.progress(1));
    expect(status().textContent).not.toContain("Reading");
    act(() => vi.advanceTimersByTime(ACTIVITY_DELAY_MS));

    expect(status().hasAttribute("data-compact")).toBe(false);
    expect(within(status()).getByText("dock-yard").className).toBe("je-status-scene");
    expect(within(status()).getByText("Saved")).toBeTruthy();
    const label = status().querySelector(".je-activity-label")!;
    expect(label.textContent).toBe("Reading review-big-2.png");
    expect(status().querySelector(".je-activity-count")!.textContent).toBe("1 of 5");
    const cell = status().closest<HTMLElement>(".je-frame-status")!;
    const room = Number.parseFloat(cell.style.maxWidth);
    const dockRoom = Number(document.querySelector("[data-room]")!.getAttribute("data-room"));
    expect(room + 8 + dockRoom).toBeLessThanOrEqual(816);
    expect(dockRoom).toBeGreaterThanOrEqual(dock.least);
  });
});

describe("the context and the banner", () => {
  function editor(opts: { readOnly?: boolean; prefab?: boolean } = {}) {
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "dock-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const host = new Store<EditorHostState>({
      connection: "live",
      sceneChanged: false,
      ...(opts.readOnly
        ? {
            readOnly: {
              code: "code-skew",
              detail: { kind: "scene", mine: "a", project: "b" },
            } as unknown as EditorHostState["readOnly"],
          }
        : {}),
    });
    const { game } = fakeWorldGame(registry);
    render(
      <EditorFrame
        topLeft={<div style={{ width: 200 }}>site</div>}
        {...editorChrome({
          session,
          host,
          game,
          notify,
          onPlay: vi.fn(),
          onReplay: vi.fn(),
          onStop: vi.fn(),
          onRestart: vi.fn(),
          ...(opts.prefab
            ? { prefab: { id: "post", scene: "posts", onBack: vi.fn(), onCreateVariant: vi.fn() } }
            : {}),
        })}
      >
        <canvas />
      </EditorFrame>,
    );
  }

  it("draws the read-only notice as a banner over the canvas, not in a column", () => {
    editor({ readOnly: true });
    const notice = screen.getByRole("status", { name: "Read only" });
    const banner = notice.closest<HTMLElement>(".je-frame-banner")!;
    expect(banner).toBeTruthy();
    expect(notice.closest(".je-frame-context, .je-frame-column")).toBeNull();
    const { canvas } = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    expect(Number.parseFloat(banner.style.left)).toBe(canvas.left);
    expect(Number.parseFloat(banner.style.right)).toBe(canvas.right);
  });

  it("draws no context without a prefab, and the prefab's breadcrumb in it as one row", () => {
    editor();
    expect(document.querySelector(".je-frame-context")).toBeNull();
    cleanup();
    editor({ prefab: true });
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    const context = crumb.closest<HTMLElement>(".je-frame-context")!;
    expect(context).toBeTruthy();
    expect(context.querySelectorAll(".je-prefab-header-row")).toHaveLength(0);
    expect(within(context).getByRole("button", { name: "Create variant" })).toBeTruthy();
    // jsdom lays out nothing, so the host's chrome measures 0 wide: the context starts at the inset.
    expect(context.style.top).toBe("8px");
    expect(context.style.left).toBe("8px");
    // With no top-right chrome the right column starts at the top inset.
    expect(document.querySelector<HTMLElement>(".je-frame-right")?.style.top).toBe("8px");
  });
  it("sits beside the host's chrome while the top row has room, and below it when not", () => {
    const sizes: Record<string, [number, number]> = {
      "je-frame-top-left": [420, 40],
      "je-frame-context": [300, 34],
    };
    const real = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!
      .value as (this: Element) => DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const size = Object.entries(sizes).find(([cls]) => this.classList.contains(cls))?.[1];
        return size ? new DOMRect(0, 0, size[0], size[1]) : real.call(this);
      },
    );
    try {
      editor({ prefab: true });
      const context = document.querySelector<HTMLElement>(".je-frame-context")!;
      expect(context.style.left).toBe(`${8 + 420 + 8}px`);
      expect(context.style.top).toBe("8px");
      const left = document.querySelector<HTMLElement>(".je-frame-left")!;
      expect(left.style.top).toBe(`${8 + 40 + 8}px`);

      // At 760 one column is drawn and the right one leaves the context too little room beside.
      resizeWindow(760);
      expect(context.style.left).toBe("8px");
      expect(context.style.top).toBe(`${8 + 40 + 8}px`);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
