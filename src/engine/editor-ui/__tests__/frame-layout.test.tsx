// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import {
  createEditorSession,
  selectionBounds,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { AssetKey } from "../../project/index";
import {
  EditorFrame,
  editorChrome,
  Island,
  type EditorFrameHandle,
  type FramePanels,
} from "../frame/EditorFrame";
import { visibleFrame } from "../frame/visible-rect";
import type { EditorStorage } from "../host";
import {
  DEFAULT_LAYOUT,
  fitLayout,
  type EditorLayout,
  type FittedColumn,
  type Viewport,
} from "../layout/model";
import { LAYOUT_KEY, LAYOUT_WRITE_DELAY } from "../layout/use-layout";
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

/** `pad` sits half a pixel off the grid: one warning to frame from Problems. */
const scene: SceneDefinition = {
  v: 1,
  name: "layout-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "pad", type: "marker", at: [1000.005, 1010] }],
};

const newSession = () =>
  createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "layout-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });

function memoryStorage(initial?: EditorLayout): EditorStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial) data.set(LAYOUT_KEY, JSON.stringify(initial));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const stored = (storage: { data: Map<string, string> }): EditorLayout =>
  JSON.parse(storage.data.get(LAYOUT_KEY)!) as EditorLayout;

function resizeWindow(width: number, height = 900) {
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event("resize"));
  });
}

/** What the frame measures in jsdom: the window, with no host chrome or bottom row laid out. */
const viewportOf = (width: number, height = 900): Viewport => ({
  width,
  height,
  topLeft: 0,
  topRight: 0,
  bottom: 0,
});

const px = (el: Element, prop: "left" | "top" | "width" | "height" | "maxWidth") =>
  Number.parseFloat((el as HTMLElement).style[prop]);

const column = (side: "left" | "right") =>
  document.querySelector<HTMLElement>(`.je-frame-column.je-frame-${side}`);

const separator = (name: string) => screen.getByRole("separator", { name });

function expectColumnAt(side: "left" | "right", fitted: FittedColumn) {
  const el = column(side)!;
  expect(px(el, "left")).toBe(fitted.x);
  expect(px(el, "top")).toBe(fitted.y);
  expect(px(el, "width")).toBe(fitted.width);
  expect(px(el, "height")).toBe(fitted.height);
  fitted.groups.forEach((g, i) => {
    const group = el.querySelector(`.je-frame-group-${side}-${i}`)!;
    expect(px(group, "top")).toBe(g.y);
    expect(px(group, "height")).toBe(g.height);
  });
}

function panelsFor(session = newSession()): FramePanels {
  return {
    context: {
      controls: {
        session,
        notify,
        runStore: new Store<LoadedRun | null>(null),
        playFrom: vi.fn(),
        onReplay: vi.fn(),
        frame: () => true,
      },
      physical: new Store<readonly SceneIssue[]>([]),
      pickedAsset: new Store<AssetKey | null>(null),
    },
  };
}

function setup({
  storage = memoryStorage(),
  mode = new Store({ mode: "edit" }),
}: { storage?: ReturnType<typeof memoryStorage>; mode?: Store<{ mode: string }> } = {}) {
  const handle = createRef<EditorFrameHandle>();
  const view = render(
    <EditorFrame
      host={{ storage }}
      frameRef={handle}
      panels={panelsFor()}
      mode={mode}
      dock={
        <Island>
          <button type="button">dock</button>
        </Island>
      }
      status={<Island>status</Island>}
    >
      <canvas />
    </EditorFrame>,
  );
  return { storage, mode, handle, view };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  resizeWindow(1440, 900);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the frame's layout", () => {
  it("places every column and group at fitLayout's px", () => {
    setup();
    const fitted = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    expect(fitted.mode).toBe("desktop");
    expectColumnAt("left", fitted.left!);
    expectColumnAt("right", fitted.right!);
    expect(within(column("right")!).getAllByRole("tablist").length).toBe(2);
  });

  it("draws a customised layout from storage as stored", () => {
    const custom: EditorLayout = {
      ...DEFAULT_LAYOUT,
      right: {
        ...DEFAULT_LAYOUT.right,
        width: 420,
        groups: [DEFAULT_LAYOUT.right.groups[0], { ...DEFAULT_LAYOUT.right.groups[1]!, size: 360 }],
      },
    };
    setup({ storage: memoryStorage(custom) });
    const fitted = fitLayout(custom, viewportOf(1440));
    expectColumnAt("right", fitted.right!);
    expect(px(column("right")!, "width")).toBe(420);
  });

  it("moves a column's edge 8 px per arrow and 32 with Shift, to the limits with Home and End", () => {
    const { storage } = setup();
    const edge = separator("Right column edge");
    expect(edge.getAttribute("aria-orientation")).toBe("vertical");
    expect(edge.getAttribute("aria-valuenow")).toBe("320");
    expect(edge.getAttribute("aria-valuemin")).toBe("232");
    expect(edge.getAttribute("aria-valuemax")).toBe("520");
    expect(edge.tabIndex).toBe(0);

    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(px(column("right")!, "width")).toBe(328);
    fireEvent.keyDown(edge, { key: "ArrowLeft", shiftKey: true });
    expect(px(column("right")!, "width")).toBe(360);
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(px(column("right")!, "width")).toBe(352);
    expect(separator("Right column edge").getAttribute("aria-valuenow")).toBe("352");

    const left = separator("Left column edge");
    fireEvent.keyDown(left, { key: "ArrowRight", shiftKey: true });
    expect(px(column("left")!, "width")).toBe(320);
    fireEvent.keyDown(left, { key: "Home" });
    expect(px(column("left")!, "width")).toBe(232);
    fireEvent.keyDown(left, { key: "End" });
    expect(px(column("left")!, "width")).toBe(520);

    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(stored(storage).right.width).toBe(352);
    expect(stored(storage).left.width).toBe(520);
  });

  it("collapses a column to its rail with Enter, and the rail opens it again", () => {
    setup();
    fireEvent.keyDown(separator("Right column edge"), { key: "Enter" });
    expect(column("right")).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Right panels" });
    const fitted = fitLayout(
      { ...DEFAULT_LAYOUT, right: { ...DEFAULT_LAYOUT.right, collapsed: true } },
      viewportOf(1440),
    );
    expect(px(rail, "width")).toBe(fitted.right!.width);
    expect(px(rail, "left")).toBe(fitted.right!.x);

    fireEvent.click(within(rail).getByRole("button", { name: "History" }));
    expect(column("right")).not.toBeNull();
    expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("restores the default width and split on double-click", () => {
    setup();
    const edge = separator("Right column edge");
    fireEvent.keyDown(edge, { key: "End" });
    expect(px(column("right")!, "width")).toBe(520);
    fireEvent.doubleClick(separator("Right column edge"));
    expect(px(column("right")!, "width")).toBe(320);

    const split = separator("Right column split");
    expect(split.getAttribute("aria-orientation")).toBe("horizontal");
    fireEvent.keyDown(split, { key: "ArrowUp", shiftKey: true });
    const bottom = () => column("right")!.querySelector(".je-frame-group-right-1")!;
    expect(px(bottom(), "height")).toBe(272);
    fireEvent.doubleClick(separator("Right column split"));
    expect(px(bottom(), "height")).toBe(240);
  });

  it("moves the split with arrows, collapses the bottom group with Enter", () => {
    setup();
    const split = separator("Right column split");
    const bottom = () => column("right")!.querySelector(".je-frame-group-right-1")!;
    const top = () => column("right")!.querySelector(".je-frame-group-right-0")!;
    fireEvent.keyDown(split, { key: "ArrowUp" });
    expect(px(bottom(), "height")).toBe(248);
    fireEvent.keyDown(split, { key: "ArrowDown", shiftKey: true });
    expect(px(bottom(), "height")).toBe(216);
    const columnHeight = px(column("right")!, "height");
    expect(px(top(), "height") + px(bottom(), "height") + 8).toBe(columnHeight);

    fireEvent.keyDown(separator("Right column split"), { key: "Enter" });
    expect(px(bottom(), "height")).toBe(28);
    expect(px(top(), "height")).toBe(columnHeight - 8 - 28);
    fireEvent.keyDown(separator("Right column split"), { key: "Enter" });
    expect(px(bottom(), "height")).toBe(216);
  });

  it("previews a pointer drag and writes the width once, on release", () => {
    const { storage } = setup();
    const edge = separator("Right column edge");
    const capture = vi.fn();
    edge.setPointerCapture = capture;
    fireEvent.pointerDown(edge, { pointerId: 1, button: 0, clientX: 1100 });
    fireEvent.pointerMove(edge, { pointerId: 1, clientX: 1050 });
    expect(px(column("right")!, "width")).toBe(370);
    fireEvent.pointerMove(edge, { pointerId: 1, clientX: 1000 });
    expect(px(column("right")!, "width")).toBe(420);
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(storage.data.has(LAYOUT_KEY)).toBe(false);

    fireEvent.pointerUp(edge, { pointerId: 1, clientX: 1000 });
    expect(px(column("right")!, "width")).toBe(420);
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(stored(storage).right.width).toBe(420);
    expect(capture).toHaveBeenCalledWith(1);
  });

  it("draws one column and a rail at a narrow width, keeping the stored widths", () => {
    const { storage } = setup();
    fireEvent.keyDown(separator("Right column edge"), { key: "End" });
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    const layout = stored(storage);
    expect(layout.right.width).toBe(520);

    resizeWindow(1024);
    const at1024 = fitLayout(layout, viewportOf(1024));
    expect(at1024.mode).toBe("desktop");
    expectColumnAt("left", at1024.left!);
    expectColumnAt("right", at1024.right!);
    expect(at1024.left!.x + at1024.left!.width).toBeLessThan(at1024.right!.x);

    resizeWindow(760);
    const at760 = fitLayout(layout, viewportOf(760));
    expect(at760.mode).toBe("single");
    expect(column("left")).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Left panels" });
    expect(px(rail, "width")).toBe(at760.left!.width);
    expectColumnAt("right", at760.right!);
    expect(px(column("right")!, "width")).toBeLessThan(520);

    resizeWindow(1440);
    expect(px(column("right")!, "width")).toBe(520);
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(stored(storage)).toEqual(layout);
  });

  it("uses the phone layout under 640 px: no columns, a panel bar and one group in a sheet", () => {
    setup();
    resizeWindow(500, 800);
    expect(column("left")).toBeNull();
    expect(column("right")).toBeNull();
    const bar = screen.getByRole("navigation", { name: "Right panels" });
    fireEvent.click(within(bar).getByRole("button", { name: "Run" }));
    const strip = screen.getByRole("tablist", { name: "Right column, bottom group" });
    expect(within(strip).getByRole("tab", { name: /Run/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.queryByRole("tablist", { name: "Right column, top group" })).toBeNull();
    // As tall as the panel's content, up to half the window.
    const sheet = strip.closest<HTMLElement>(".je-frame-sheet")!;
    expect(sheet.style.height).toBe("");
    expect(sheet.style.maxHeight).toBe("400px");
    fireEvent.click(within(bar).getByRole("button", { name: "Run" }));
    expect(screen.queryByRole("tablist", { name: "Right column, bottom group" })).toBeNull();
  });

  it("hides the columns, rails and status in play mode and keeps the dock", () => {
    const { mode } = setup();
    act(() => mode.setState(() => ({ mode: "play" })));
    const columns = document.querySelector<HTMLElement>(".je-frame-columns")!;
    expect(columns.hidden).toBe(true);
    expect(columns.hasAttribute("inert")).toBe(true);
    expect(column("left")!.closest("[hidden]")).toBe(columns);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(screen.queryByRole("tab", { name: /Inspector/ })).toBeNull();
    expect(screen.queryByText("status")).toBeNull();
    expect(screen.getByRole("button", { name: "dock" })).toBeTruthy();
    act(() => mode.setState(() => ({ mode: "edit" })));
    expect(columns.hidden).toBe(false);
    expectColumnAt("right", fitLayout(DEFAULT_LAYOUT, viewportOf(1440)).right!);
  });

  it("keeps the panels mounted through a playtest: the outliner's filter survives Play and Stop", () => {
    const { mode } = setup();
    const filter = screen.getByRole("searchbox", { name: "Filter rows" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "pad" } });
    act(() => mode.setState(() => ({ mode: "play" })));
    act(() => mode.setState(() => ({ mode: "edit" })));
    const after = screen.getByRole("searchbox", { name: "Filter rows" }) as HTMLInputElement;
    expect(after).toBe(filter);
    expect(after.value).toBe("pad");
  });

  it("keeps the inspector group's height through Play and Stop", () => {
    const { mode } = setup();
    const inspector = () =>
      column("right")!.querySelector<HTMLElement>(".je-frame-group-right-0")!.style.height;
    const before = inspector();
    expect(before).toMatch(/px$/);
    act(() => mode.setState(() => ({ mode: "play" })));
    expect(inspector()).toBe(before);
    act(() => mode.setState(() => ({ mode: "edit" })));
    expect(inspector()).toBe(before);
  });

  it("skips the hidden columns when F6 cycles the regions in play mode", () => {
    const { mode } = setup();
    act(() => mode.setState(() => ({ mode: "play" })));
    fireEvent.keyDown(window, { key: "F6" });
    expect(document.activeElement?.closest(".je-frame-columns")).toBeNull();
    expect(screen.getByRole("button", { name: "dock" })).toBe(document.activeElement);
  });

  it("brings both columns back when the window widens after a rail opened one at 760", () => {
    const { storage } = setup();
    resizeWindow(760, 700);
    const rail = screen.getByRole("navigation", { name: "Left panels" });
    fireEvent.click(within(rail).getByRole("button", { name: "Outliner" }));
    expect(column("left")).not.toBeNull();
    expect(column("right")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Right panels" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(stored(storage).right.collapsed).toBe(false);

    resizeWindow(1440, 900);
    const fitted = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    expectColumnAt("left", fitted.left!);
    expectColumnAt("right", fitted.right!);
  });

  it("shares the phone's top bar between the host's two corners, the left one stopping short", () => {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!
      .value as (this: Element) => DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.classList.contains("je-frame-top-right")) return new DOMRect(0, 0, 120, 40);
        if (this.classList.contains("je-frame-top-left")) return new DOMRect(0, 0, 300, 40);
        return real.call(this);
      },
    );
    try {
      resizeWindow(375, 812);
      render(
        <EditorFrame
          host={{ storage: memoryStorage() }}
          panels={panelsFor()}
          topLeft={<div>a long site menu title</div>}
          topRight={<div>share</div>}
        >
          <canvas />
        </EditorFrame>,
      );
      const left = document.querySelector<HTMLElement>(".je-frame-top-left")!;
      const right = document.querySelector<HTMLElement>(".je-frame-top-right")!;
      expect(document.querySelector(".je-frame-chrome")!.getAttribute("data-je-mode")).toBe(
        "phone",
      );
      expect(px(left, "maxWidth")).toBe(375 - 8 - 8 - 8 - 120);
      expect(right).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("places the default toasts inside the canvas area, above the bottom row", () => {
    const { mode } = setup();
    const frame = document.querySelector<HTMLElement>(".je-frame")!;
    const fitted = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    expect(frame.style.getPropertyValue("--je-toasts-right")).toBe(`${fitted.canvas.right + 8}px`);
    expect(frame.style.getPropertyValue("--je-toasts-bottom")).toBe("8px");
    act(() => mode.setState(() => ({ mode: "play" })));
    expect(frame.style.getPropertyValue("--je-toasts-right")).toBe("8px");
  });

  it("places the bottom row between the columns", () => {
    setup();
    const fitted = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    const row = document.querySelector<HTMLElement>(".je-frame-bottom")!;
    expect(px(row, "left")).toBe(fitted.canvas.left);
    expect(Number.parseFloat(row.style.right)).toBe(fitted.canvas.right);
    expect(row.querySelector(".je-frame-dock")).toBeTruthy();
    expect(row.querySelector(".je-frame-status")).toBeTruthy();
  });

  it("opens a panel through its handle wherever it is, and resets the layout", () => {
    const { handle } = setup();
    expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe(
      "false",
    );
    fireEvent.keyDown(separator("Right column edge"), { key: "Enter" });
    expect(column("right")).toBeNull();
    act(() => handle.current!.openPanel("history"));
    const history = screen.getByRole("tab", { name: /History/ });
    expect(history.getAttribute("aria-selected")).toBe("true");
    expect(column("right")!.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(separator("Right column edge"), { key: "End" });
    act(() => handle.current!.resetLayout());
    expectColumnAt("right", fitLayout(DEFAULT_LAYOUT, viewportOf(1440)).right!);
  });

  it("opens a panel behind another tab in a collapsed group through its handle", () => {
    const { handle } = setup();
    const bottom = () => column("right")!.querySelector(".je-frame-group-right-1")!;
    const open = px(bottom(), "height");
    fireEvent.keyDown(separator("Right column split"), { key: "Enter" });
    expect(px(bottom(), "height")).toBe(28);
    expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe(
      "false",
    );

    act(() => handle.current!.openPanel("history"));
    expect(px(bottom(), "height")).toBe(open);
    expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe("true");
    expect(bottom().contains(document.activeElement)).toBe(true);
  });

  it("holds the left and right slots in fitted columns when there are no panels", () => {
    render(
      <EditorFrame host={{ storage: memoryStorage() }} left={<Island>tree</Island>}>
        <canvas />
      </EditorFrame>,
    );
    const fitted = fitLayout(DEFAULT_LAYOUT, viewportOf(1440));
    const left = column("left")!;
    expect(px(left, "width")).toBe(fitted.left!.width);
    expect(within(left).getByText("tree")).toBeTruthy();
    expect(column("right")).toBeNull();
    fireEvent.keyDown(separator("Left column edge"), { key: "ArrowRight" });
    expect(px(column("left")!, "width")).toBe(fitted.left!.width + 8);
  });
});

describe("framing in the editor's frame", () => {
  it("fits a framed problem into the canvas the columns leave visible", () => {
    const session = newSession();
    const registry = createRegistry();
    const { game } = fakeWorldGame(registry);
    const panBy = vi.fn();
    Object.assign(game, { panBy });
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    const storage = memoryStorage({
      ...DEFAULT_LAYOUT,
      right: { ...DEFAULT_LAYOUT.right, width: 420 },
    });
    render(
      <EditorFrame
        host={{ storage }}
        {...editorChrome({
          session,
          host,
          game,
          notify,
          onPlay: vi.fn(),
          onReplay: vi.fn(),
          onStop: vi.fn(),
          onRestart: vi.fn(),
        })}
      >
        <canvas />
      </EditorFrame>,
    );
    const issue = session.store.state.issues.find((i) => i.entityIds.includes("pad"));
    expect(issue).toBeTruthy();
    const row = screen.getByRole("listitem", { name: issue!.message });
    fireEvent.click(within(row).getAllByRole("button")[0]!);

    const fitted = fitLayout(
      { ...DEFAULT_LAYOUT, right: { ...DEFAULT_LAYOUT.right, width: 420 } },
      viewportOf(1440),
    );
    const framed = (game.frame as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    const plain = selectionBounds(session.getResolved(), session.registry, issue!.entityIds)!;
    const expected = visibleFrame(plain, {
      width: 1440,
      height: 900,
      insets: fitted.canvas,
    });
    expect(framed).toEqual(expected.rect);
    expect(panBy).toHaveBeenCalledWith(expected.pan);
    expect(expected.pan.x).toBe((fitted.canvas.left - fitted.canvas.right) / 2);
  });
});
